// Sandbox de commandes du workspace — exécution RÉELLE et confinée.
// Sécurité :
//  - liste blanche stricte de binaires et de sous-commandes ;
//  - exécution via execFile SANS shell : aucune injection possible, même si la
//    chaîne provient de l'utilisateur ou d'une réponse de l'IA ;
//  - répertoire de travail confiné à l'espace de la session (propriétaire seul) ;
//  - arguments « .. », chemins absolus et « ~ » refusés (pas d'évasion) ;
//  - find : options d'exécution (-exec/-ok/-delete…) bloquées ;
//  - npm : UNIQUEMENT install avec --ignore-scripts forcé (aucun script de
//    paquet exécuté) ; npm run/test/start exigent une isolation par conteneur
//    (non disponible ici) et sont refusés avec un message explicite ;
//  - délais maximaux (10 s, 300 s pour npm install), sorties plafonnées ;
//  - journal d'audit workspace.exec pour chaque commande.
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const BIN = new Set([
  "ls", "pwd", "cat", "echo", "grep", "find", "wc", "head", "tail",
  "mkdir", "touch", "cp", "mv", "rm", "du", "git", "npm",
]);
const GIT_SUB = new Set([
  "init", "status", "add", "commit", "log", "diff", "branch", "show",
  "config", "rm", "mv", "checkout", "restore", "tag",
]);
// find : toute option déclenchant une exécution ou une suppression est bloquée
const FIND_FORBIDDEN = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprintf", "-fprint", "-fls"]);

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function refuse(stderr: string, exitCode: number) {
  return NextResponse.json({ stdout: "", stderr, exitCode, durationMs: 0 });
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { command?: string };
  const command = (body.command ?? "").trim();
  if (!command || command.length > 500) {
    return NextResponse.json({ error: "Commande vide ou trop longue" }, { status: 400 });
  }
  // opérateurs shell refusés d'emblée (aucun shell n'est invoqué de toute façon)
  if (/[|&;<>`$]/.test(command)) {
    return refuse("opérateurs shell (| & ; < > ` $) non pris en charge : une seule commande à la fois", 126);
  }

  const argv = tokenize(command);
  const bin = argv[0] ?? "";
  if (!BIN.has(bin)) {
    return refuse(
      `commande refusée : « ${bin} » — autorisées : ${[...BIN].join(", ")} (git : ${[...GIT_SUB].join(", ")})`,
      127
    );
  }
  for (const a of argv.slice(1)) {
    if (a.includes("..") || a.startsWith("/") || a.startsWith("~") || a.includes("\\")) {
      return refuse(`argument refusé : « ${a} » (accès hors workspace interdit)`, 126);
    }
  }
  if (bin === "git" && !GIT_SUB.has(argv[1] ?? "")) {
    return refuse(`sous-commande git refusée — autorisées : ${[...GIT_SUB].join(", ")}`, 126);
  }
  if (bin === "find" && argv.some((a) => FIND_FORBIDDEN.has(a))) {
    return refuse("options find d'exécution/suppression interdites (-exec, -delete…)", 126);
  }

  const dir = path.join(process.cwd(), "data", "workspaces", id);
  fs.mkdirSync(dir, { recursive: true });

  let finalArgv = argv;
  let timeout = 10_000;
  if (bin === "git") {
    finalArgv = ["git", "-c", "user.name=CORTEXP", "-c", "user.email=agent@cortexp.local", "-c", "init.defaultBranch=main", ...argv.slice(1)];
  } else if (bin === "npm") {
    const sub = argv[1] ?? "";
    if (sub === "install" || sub === "i" || sub === "ci") {
      // --ignore-scripts : AUCUN script de paquet (postinstall…) n'est exécuté.
      finalArgv = ["npm", "install", ...argv.slice(2).filter((a) => !a.startsWith("-")), "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"];
      timeout = 300_000;
    } else if (sub === "ls" || sub === "view" || sub === "--version" || sub === "-v") {
      finalArgv = argv;
    } else {
      return refuse(
        `npm ${sub} refusé : l'exécution de scripts arbitraires (run/test/start) exige une isolation par conteneur dédiée, non disponible dans cet environnement. Autorisés : npm install (--ignore-scripts forcé), npm ls, npm view. Téléchargez le ZIP pour exécuter le projet localement.`,
        126
      );
    }
  }

  const t0 = Date.now();
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    execFile(
      finalArgv[0],
      finalArgv.slice(1),
      {
        cwd: dir,
        timeout,
        maxBuffer: 512 * 1024,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: dir, // confinement : ni ~/.gitconfig ni ~/.npmrc de l'hôte
          GIT_CONFIG_NOSYSTEM: "1",
          LANG: "C.UTF-8",
          npm_config_cache: path.join(dir, ".npm-cache"),
        },
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
        resolve({
          stdout: String(stdout).slice(0, 40_000),
          stderr: e?.killed ? `délai dépassé (${Math.round(timeout / 1000)} s)` : String(stderr).slice(0, 20_000),
          exitCode: e ? (typeof e.code === "number" ? e.code : 1) : 0,
        });
      }
    );
  });
  const durationMs = Date.now() - t0;

  await audit({
    actorId: user.id,
    actorName: user.username ?? user.email ?? "?",
    action: "workspace.exec",
    target: id,
    detail: command.slice(0, 120),
  });

  return NextResponse.json({ ...result, durationMs });
}

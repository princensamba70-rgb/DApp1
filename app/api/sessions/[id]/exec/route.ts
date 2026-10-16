// Sandbox de commandes du workspace — exécution RÉELLE et confinée.
// Sécurité : liste blanche stricte (ls, pwd, cat, echo, git …), exécution via
// execFile SANS shell (aucune injection possible), répertoire confiné à
// l'espace de travail de la session, délai 5 s, sortie plafonnée, aucun accès
// hors du workspace (arguments « .. », « / », « ~ » refusés).
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const BIN = new Set(["ls", "pwd", "cat", "echo", "git", "wc", "head"]);
const GIT_SUB = new Set(["init", "status", "add", "commit", "log", "diff", "branch", "show", "config", "rm", "mv"]);

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { command?: string };
  const command = (body.command ?? "").trim();
  if (!command || command.length > 300) {
    return NextResponse.json({ error: "Commande vide ou trop longue" }, { status: 400 });
  }

  const argv = tokenize(command);
  const bin = argv[0];
  if (!BIN.has(bin)) {
    return NextResponse.json({
      stdout: "",
      stderr: `commande refusée : « ${bin} » — autorisées : ${[...BIN].join(", ")} (git : ${[...GIT_SUB].join(", ")})`,
      exitCode: 127,
    });
  }
  for (const a of argv.slice(1)) {
    if (a.includes("..") || a.startsWith("/") || a.startsWith("~") || a.includes("\\")) {
      return NextResponse.json({ stdout: "", stderr: `argument refusé : « ${a} » (accès hors workspace interdit)`, exitCode: 126 });
    }
  }
  if (bin === "git" && !GIT_SUB.has(argv[1] ?? "")) {
    return NextResponse.json({ stdout: "", stderr: `sous-commande git refusée — autorisées : ${[...GIT_SUB].join(", ")}`, exitCode: 126 });
  }

  const dir = path.join(process.cwd(), "data", "workspaces", id);
  fs.mkdirSync(dir, { recursive: true });

  const finalArgv =
    bin === "git"
      ? ["git", "-c", "user.name=CORTEXP", "-c", "user.email=agent@cortexp.local", "-c", "init.defaultBranch=main", ...argv.slice(1)]
      : argv;

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    execFile(
      finalArgv[0],
      finalArgv.slice(1),
      {
        cwd: dir,
        timeout: 5000,
        maxBuffer: 256 * 1024,
        env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", LANG: "C.UTF-8" },
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
        resolve({
          stdout: String(stdout).slice(0, 20_000),
          stderr: e?.killed ? "délai dépassé (5 s)" : String(stderr).slice(0, 10_000),
          exitCode: e ? (typeof e.code === "number" ? e.code : 1) : 0,
        });
      }
    );
  });

  await audit({
    actorId: user.id,
    actorName: user.username ?? user.email ?? "?",
    action: "workspace.exec",
    target: id,
    detail: command.slice(0, 120),
  });

  return NextResponse.json(result);
}

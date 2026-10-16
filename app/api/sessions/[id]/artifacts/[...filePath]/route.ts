// Téléchargement/affichage d'un fichier généré par l'agent (propriétaire uniquement).
// Prend en charge les sous-dossiers (/artifacts/src/app.js). Confinement strict :
// chaque segment est validé, résolution vérifiée dans le workspace, aucune traversée.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { workspaceDir, resolveInWorkspace, isExcludedFile } from "@/lib/workspace";

type Ctx = { params: Promise<{ id: string; filePath: string[] }> };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".py": "text/x-python; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

export async function GET(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id, filePath } = await ctx.params;
  const url = new URL(req.url);
  // ?inline=1 : affichage dans l'aperçu (iframe) ; ?raw=1 : texte brut pour la vue code
  const inline = url.searchParams.get("inline") === "1";
  const raw = url.searchParams.get("raw") === "1";

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return new Response("Introuvable", { status: 404 });

  const rel = (filePath ?? []).map(decodeURIComponent).join("/");
  const dir = workspaceDir(id);
  const abs = resolveInWorkspace(dir, rel);
  const base = rel.split("/").pop() ?? "";
  if (!abs || isExcludedFile(base)) return new Response("Nom invalide", { status: 400 });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response("Fichier introuvable", { status: 404 });

  const ext = path.extname(base).toLowerCase();
  const type = raw ? "text/plain; charset=utf-8" : MIME[ext] ?? "application/octet-stream";
  const disposition = (inline && MIME[ext]) || raw ? "inline" : `attachment; filename="${base}"`;
  return new Response(fs.readFileSync(abs), {
    headers: { "content-type": type, "content-disposition": disposition },
  });
}

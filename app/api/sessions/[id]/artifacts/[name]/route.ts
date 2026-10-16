// Téléchargement d'un fichier généré par l'agent (propriétaire uniquement).
// Confinement strict : nom simple validé, aucune traversée de répertoire.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string; name: string }> };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".py": "text/x-python; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export async function GET(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id, name } = await ctx.params;
  // ?inline=1 : affichage dans l'aperçu du workspace (iframe) au lieu du téléchargement
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return new Response("Introuvable", { status: 404 });

  if (!/^[\w.-]+$/.test(name) || name.includes("..")) return new Response("Nom invalide", { status: 400 });
  const file = path.join(process.cwd(), "data", "workspaces", id, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Fichier introuvable", { status: 404 });

  const ext = path.extname(name).toLowerCase();
  const disposition = inline && MIME[ext] ? "inline" : `attachment; filename="${name}"`;
  return new Response(fs.readFileSync(file), {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-disposition": disposition,
    },
  });
}

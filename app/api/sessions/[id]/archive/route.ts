// Téléchargement du projet complet d'une session au format ZIP (propriétaire).
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { buildZip } from "@/lib/zip";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return new Response("Introuvable", { status: 404 });

  const dir = path.join(process.cwd(), "data", "workspaces", id);
  if (!fs.existsSync(dir)) return new Response("Aucun fichier généré", { status: 404 });

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^[\w.-]+$/.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }));
  if (files.length === 0) return new Response("Aucun fichier généré", { status: 404 });

  const zip = buildZip(files);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="projet-cortexp-${id.slice(-8)}.zip"`,
      "content-length": String(zip.length),
    },
  });
}

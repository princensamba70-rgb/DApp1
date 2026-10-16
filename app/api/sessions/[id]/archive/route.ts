// Téléchargement du projet complet d'une session au format ZIP (propriétaire).
// L'archive préserve l'arborescence (sous-dossiers inclus) et applique la
// politique d'exclusion : jamais de .git, node_modules, caches ni fichiers
// .env (seul .env.example, sans secret, est conservé).
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { buildZip } from "@/lib/zip";
import { workspaceDir, listWorkspaceFiles } from "@/lib/workspace";

type Ctx = { params: Promise<{ id: string }> };

const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 Mo — garde-fou

export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return new Response("Introuvable", { status: 404 });

  const dir = workspaceDir(id);
  const entries = listWorkspaceFiles(dir);
  if (entries.length === 0) return new Response("Aucun fichier généré", { status: 404 });

  let total = 0;
  const files: { name: string; data: Buffer }[] = [];
  for (const e of entries) {
    total += e.size;
    if (total > MAX_ZIP_BYTES) return new Response("Projet trop volumineux pour un ZIP", { status: 413 });
    files.push({ name: e.name, data: fs.readFileSync(path.join(dir, ...e.name.split("/"))) });
  }

  const zip = buildZip(files);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="projet-cortexp-${id.slice(-8)}.zip"`,
      "content-length": String(zip.length),
    },
  });
}

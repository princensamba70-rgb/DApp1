// Liste des fichiers générés par l'agent pour une session (propriétaire uniquement).
// Parcours récursif (sous-dossiers inclus) avec politique d'exclusion :
// .git, node_modules, caches et fichiers .env n'apparaissent jamais.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { workspaceDir, listWorkspaceFiles } from "@/lib/workspace";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json({ files: listWorkspaceFiles(workspaceDir(id)) });
}

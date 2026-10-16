// Liste des projets générés de l'utilisateur connecté : sessions disposant
// d'un espace de travail non vide, avec dates et volumétrie. Isolation stricte :
// uniquement les sessions dont l'utilisateur est propriétaire.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { workspaceDir, listWorkspaceFiles } from "@/lib/workspace";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const sessions = await prisma.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    take: 100,
  });

  const projects = sessions
    .map((s) => {
      const files = listWorkspaceFiles(workspaceDir(s.id));
      return {
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        fileCount: files.length,
        totalSize: files.reduce((a, f) => a + f.size, 0),
      };
    })
    .filter((p) => p.fileCount > 0);

  return NextResponse.json({ projects });
}

// Liste des fichiers générés par l'agent pour une session (propriétaire uniquement).
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const dir = path.join(process.cwd(), "data", "workspaces", id);
  if (!fs.existsSync(dir)) return NextResponse.json({ files: [] });

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^[\w.-]+$/.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
  return NextResponse.json({ files });
}

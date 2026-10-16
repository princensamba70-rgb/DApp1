import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({ session });
}

// Renommage d'un projet/session (propriétaire uniquement).
export async function PATCH(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = String(body.title ?? "").trim().slice(0, 120);
  if (!title) return NextResponse.json({ error: "Titre vide" }, { status: 400 });

  const updated = await prisma.chatSession.update({ where: { id }, data: { title } });
  return NextResponse.json({ session: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({ where: { id, userId: user.id } });
  if (!session) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await prisma.chatSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

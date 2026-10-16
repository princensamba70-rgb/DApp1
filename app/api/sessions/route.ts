import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const sessions = await prisma.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, mode: true, updatedAt: true },
    take: 100,
  });
  return NextResponse.json({ sessions });
}

const createSchema = z.object({
  mode: z.enum(["agent", "kingly"]).default("agent"),
  title: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  const session = await prisma.chatSession.create({
    data: {
      userId: user.id,
      mode: parsed.data.mode,
      title: parsed.data.title?.slice(0, 120) || "Nouvelle session",
    },
  });
  return NextResponse.json({ session });
}

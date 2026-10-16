import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { todayKey } from "@/lib/usage";

// Sélection SANS passwordHash : le hash ne sort JAMAIS vers le navigateur.
const userSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  role: true,
  plan: true,
  dailyMessageLimit: true,
  isActive: true,
  createdAt: true,
} as const;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { createdAt: "asc" },
  });
  const usages = await prisma.usage.findMany({ where: { day: todayKey() } });
  const usageByUser = Object.fromEntries(usages.map((u) => [u.userId, u.messages]));

  return NextResponse.json({
    users: users.map((u) => ({ ...u, usedToday: usageByUser[u.id] ?? 0 })),
  });
}

const createSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  name: z.string().min(1).max(64),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(8).max(128),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  dailyMessageLimit: z.number().int().min(0).max(100000).nullable().default(50),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }
  const { username, name, email, password, role, dailyMessageLimit } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
  });
  if (existing) return NextResponse.json({ error: "Nom d'utilisateur ou email déjà pris." }, { status: 409 });

  const user = await prisma.user.create({
    data: {
      username,
      name,
      email: email || null,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      dailyMessageLimit,
    },
    select: userSelect,
  });

  await audit({
    actorId: admin.id,
    actorName: admin.username ?? "admin",
    action: "admin.user.create",
    target: username,
    detail: `role=${role} limite=${dailyMessageLimit ?? "illimitée"}`,
  });
  return NextResponse.json({ user });
}

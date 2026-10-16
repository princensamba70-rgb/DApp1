import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const schema = z.object({
  username: z
    .string()
    .min(3, "3 caractères minimum")
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Lettres, chiffres, _ . - uniquement"),
  name: z.string().min(1).max(64),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(8, "8 caractères minimum").max(128),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`register:${ip}`, 5)) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez dans 10 minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  }
  const { username, name, email, password } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
  });
  if (existing) {
    return NextResponse.json({ error: "Nom d'utilisateur ou email déjà utilisé." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const limit = Number(process.env.DEFAULT_DAILY_MESSAGE_LIMIT || 50);
  const user = await prisma.user.create({
    data: {
      username,
      name,
      email: email || null,
      passwordHash,
      role: "USER",
      dailyMessageLimit: Number.isFinite(limit) ? limit : 50,
    },
  });

  await audit({ actorId: user.id, actorName: username, action: "auth.register", ip });
  return NextResponse.json({ ok: true });
}

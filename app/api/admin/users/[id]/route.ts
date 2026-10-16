import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  plan: z.enum(["free", "pro", "team"]).optional(),
  dailyMessageLimit: z.number().int().min(0).max(100000).nullable().optional(),
  isActive: z.boolean().optional(),
  // Réinitialisation du mot de passe par l'admin (re-haché, jamais renvoyé)
  newPassword: z.string().min(8).max(128).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const { id } = await ctx.params;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  const data = parsed.data;

  // Garde-fou : l'admin ne peut pas se rétrograder/désactiver lui-même.
  if (id === admin.id && (data.role === "USER" || data.isActive === false)) {
    return NextResponse.json({ error: "Impossible de rétrograder ou désactiver son propre compte admin." }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.plan !== undefined ? { plan: data.plan } : {}),
      ...(data.dailyMessageLimit !== undefined ? { dailyMessageLimit: data.dailyMessageLimit } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.newPassword ? { passwordHash: await bcrypt.hash(data.newPassword, 12) } : {}),
    },
    select: {
      id: true, username: true, email: true, name: true, role: true, plan: true,
      dailyMessageLimit: true, isActive: true, createdAt: true,
    },
  });

  await audit({
    actorId: admin.id,
    actorName: admin.username ?? "admin",
    action: "admin.user.update",
    target: target.username ?? target.email ?? id,
    detail: Object.keys(data).filter((k) => k !== "newPassword").join(",") + (data.newPassword ? ",password_reset" : ""),
  });
  return NextResponse.json({ user: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const { id } = await ctx.params;

  if (id === admin.id) {
    return NextResponse.json({ error: "Impossible de supprimer son propre compte admin." }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

  await prisma.user.delete({ where: { id } });
  await audit({
    actorId: admin.id,
    actorName: admin.username ?? "admin",
    action: "admin.user.delete",
    target: target.username ?? target.email ?? id,
  });
  return NextResponse.json({ ok: true });
}

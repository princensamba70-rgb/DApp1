import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(1).max(64).optional(),
  defaultMode: z.enum(["agent", "kingly"]).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
});

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  const { name, defaultMode, currentPassword, newPassword } = parsed.data;

  let passwordHash: string | undefined;
  if (newPassword) {
    // Changement de mot de passe : exige l'ancien (comptes à identifiants uniquement)
    if (!user.passwordHash) {
      return NextResponse.json({ error: "Ce compte utilise une connexion OAuth (Google/GitHub)." }, { status: 400 });
    }
    const ok = await bcrypt.compare(currentPassword ?? "", user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Mot de passe actuel incorrect." }, { status: 400 });
    passwordHash = await bcrypt.hash(newPassword, 12);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(defaultMode !== undefined ? { defaultMode } : {}),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });

  if (passwordHash) {
    await audit({ actorId: user.id, actorName: user.username ?? "?", action: "account.password.change" });
  }
  return NextResponse.json({ ok: true });
}

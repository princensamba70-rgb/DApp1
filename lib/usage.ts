import { prisma } from "@/lib/db";
import type { User } from "@prisma/client";

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(userId: string) {
  const day = todayKey();
  return (
    (await prisma.usage.findUnique({ where: { userId_day: { userId, day } } })) ?? {
      userId,
      day,
      messages: 0,
      tokensIn: 0,
      tokensOut: 0,
    }
  );
}

/** true si l'utilisateur peut encore envoyer un message aujourd'hui. */
export async function checkQuota(user: User): Promise<{ ok: boolean; used: number; limit: number | null }> {
  if (user.role === "ADMIN" || user.dailyMessageLimit === null) {
    const u = await getTodayUsage(user.id);
    return { ok: true, used: u.messages, limit: null };
  }
  const u = await getTodayUsage(user.id);
  return { ok: u.messages < user.dailyMessageLimit, used: u.messages, limit: user.dailyMessageLimit };
}

export async function incrementUsage(
  userId: string,
  delta: { messages?: number; tokensIn?: number; tokensOut?: number }
) {
  const day = todayKey();
  await prisma.usage.upsert({
    where: { userId_day: { userId, day } },
    update: {
      messages: { increment: delta.messages ?? 0 },
      tokensIn: { increment: delta.tokensIn ?? 0 },
      tokensOut: { increment: delta.tokensOut ?? 0 },
    },
    create: {
      userId,
      day,
      messages: delta.messages ?? 0,
      tokensIn: delta.tokensIn ?? 0,
      tokensOut: delta.tokensOut ?? 0,
    },
  });
}

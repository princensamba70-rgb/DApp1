import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayKey } from "@/lib/usage";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const [totalUsers, activeUsers, totalRuns, usagesToday, auditLogs] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.run.count(),
    prisma.usage.findMany({ where: { day: todayKey() } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const messagesToday = usagesToday.reduce((s, u) => s + u.messages, 0);
  const tokensToday = usagesToday.reduce((s, u) => s + u.tokensIn + u.tokensOut, 0);

  return NextResponse.json({
    stats: { totalUsers, activeUsers, totalRuns, messagesToday, tokensToday },
    audit: auditLogs,
  });
}

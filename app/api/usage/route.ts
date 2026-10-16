import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getTodayUsage } from "@/lib/usage";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const usage = await getTodayUsage(user.id);
  return NextResponse.json({
    used: usage.messages,
    limit: user.role === "ADMIN" ? null : user.dailyMessageLimit,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
  });
}

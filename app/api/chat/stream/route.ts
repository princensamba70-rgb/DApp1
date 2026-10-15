// Streaming SSE du moteur d'agent : quota vérifié, run et messages persistés,
// événements typés rejouables côté UI.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { checkQuota, incrementUsage } from "@/lib/usage";
import { runAgent, estimateTokens } from "@/lib/agent/engine";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(20_000),
  mode: z.enum(["agent", "kingly"]),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  const { sessionId, content, mode } = parsed.data;

  // Isolation multi-tenant : la session doit appartenir à l'utilisateur.
  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 30 } },
  });
  if (!chatSession) return NextResponse.json({ error: "Session introuvable" }, { status: 404 });

  // Quota journalier (géré par l'admin ; admin = illimité)
  const quota = await checkQuota(user);
  if (!quota.ok) {
    return NextResponse.json(
      { error: `Quota journalier atteint (${quota.used}/${quota.limit} messages). Contactez l'administrateur.` },
      { status: 429 }
    );
  }

  // Persistance du message utilisateur + titre auto de la session
  const tokensIn = estimateTokens(content);
  await prisma.message.create({
    data: { sessionId, role: "user", content, tokensIn },
  });
  await incrementUsage(user.id, { messages: 1, tokensIn });
  if (chatSession.messages.length === 0) {
    const title = content.replace(/\s+/g, " ").trim().slice(0, 60) || "Nouvelle session";
    await prisma.chatSession.update({ where: { id: sessionId }, data: { title, mode } });
  } else {
    await prisma.chatSession.update({ where: { id: sessionId }, data: { mode } });
  }

  const run = await prisma.run.create({
    data: { sessionId, userId: user.id, mode, status: "running" },
  });
  await audit({
    actorId: user.id,
    actorName: user.username ?? user.email ?? "?",
    action: "agent.run.start",
    target: run.id,
    detail: `mode=${mode}`,
  });

  const history = chatSession.messages.map((m) => ({ role: m.role, content: m.content }));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      let finalContent = "";
      try {
        const gen = runAgent(run.id, mode, content, history);
        for (;;) {
          const { value, done } = await gen.next();
          if (done) {
            // value = RunMeta final
            const meta = value;
            await prisma.message.create({
              data: {
                sessionId,
                role: "assistant",
                content: finalContent,
                meta: JSON.stringify(meta),
                tokensOut: meta.tokensOut,
              },
            });
            await prisma.run.update({
              where: { id: run.id },
              data: {
                status: "success",
                endedAt: new Date(),
                tokensIn: meta.tokensIn,
                tokensOut: meta.tokensOut,
                costUsd: meta.costUsd,
              },
            });
            await incrementUsage(user.id, { tokensOut: meta.tokensOut });
            break;
          }
          if (value.t === "content_delta") finalContent += value.text;
          send(value);
        }
      } catch (e) {
        send({ t: "error", message: "Erreur interne du moteur d'agent", kind: "unknown", recoverable: false });
        await prisma.run.update({
          where: { id: run.id },
          data: { status: "failed", endedAt: new Date() },
        }).catch(() => {});
        console.error("[agent] run failed:", e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

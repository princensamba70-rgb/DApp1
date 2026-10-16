import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import Console from "@/components/console/Console";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { sessionId } = await params;

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) notFound();

  return (
    <Console
      sessionId={session.id}
      initialMode={session.mode === "kingly" ? "kingly" : "agent"}
      initialMessages={session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        meta: m.meta,
      }))}
    />
  );
}

// Export d'une conversation au format Markdown (propriétaire uniquement).
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { id } = await ctx.params;

  const session = await prisma.chatSession.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return new Response("Introuvable", { status: 404 });

  const lines: string[] = [
    `# ${session.title}`,
    "",
    `- **Mode** : ${session.mode === "kingly" ? "KINGLY 1" : "AGENT"}`,
    `- **Créée le** : ${session.createdAt.toISOString()}`,
    `- **Exportée le** : ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ];
  for (const m of session.messages) {
    lines.push(`## ${m.role === "user" ? "🧑 Utilisateur" : "🤖 CORTEXP"} — ${m.createdAt.toISOString()}`);
    lines.push("");
    lines.push(m.content);
    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="cortexp-${id}.md"`,
    },
  });
}

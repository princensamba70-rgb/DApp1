// Provider Anthropic (streaming SSE via fetch, sans SDK pour rester léger).
// Utilisé uniquement si ANTHROPIC_API_KEY est défini et DEMO_MODE != "true".
import { systemPromptFor, modelFor } from "./prompts";

export async function* streamAnthropic(
  mode: "agent" | "kingly",
  objective: string,
  history: { role: string; content: string }[]
): AsyncGenerator<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY manquant");

  const messages = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-12)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: objective },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelFor(mode),
      system: systemPromptFor(mode),
      max_tokens: mode === "kingly" ? 4096 : 2048,
      stream: true,
      messages,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Anthropic HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          yield evt.delta.text as string;
        }
      } catch {
        // ligne partielle ignorée
      }
    }
  }
}

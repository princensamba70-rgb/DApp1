// Fournisseur « compatible OpenAI » (streaming SSE via fetch, sans SDK).
// Fonctionne avec tout serveur exposant /v1/chat/completions :
//   - LOCAUX : Ollama (http://localhost:11434/v1), LM Studio (…:1234/v1),
//     vLLM, llama.cpp server, LocalAI — aucune donnée n'est envoyée à un tiers.
//   - distants : tout service compatible, au choix explicite de l'opérateur.
import { systemPromptFor, modelFor } from "./prompts";

export async function* streamOpenAICompatible(
  mode: "agent" | "kingly",
  objective: string,
  history: { role: string; content: string }[]
): AsyncGenerator<string> {
  const base = (process.env.OPENAI_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("OPENAI_BASE_URL manquant");
  // Les serveurs locaux (Ollama, LM Studio…) acceptent une clé factice.
  const apiKey = process.env.OPENAI_API_KEY || "sk-local-no-key";

  const messages = [
    { role: "system" as const, content: systemPromptFor(mode) },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-12)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: objective },
  ];

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelFor(mode),
      max_tokens: mode === "kingly" ? 4096 : 2048,
      stream: true,
      messages,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Endpoint compatible OpenAI : HTTP ${res.status}`);
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
        const delta = evt.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) yield delta;
      } catch {
        // ligne partielle ignorée
      }
    }
  }
}

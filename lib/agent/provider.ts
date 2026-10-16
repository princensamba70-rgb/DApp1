// ── Couche d'abstraction des fournisseurs IA ────────────────────────────────
// Règle fondamentale : CORTEXP ne dépend JAMAIS d'Anthropic pour fonctionner.
//   - "local"     (défaut)   : moteur local déterministe intégré — zéro clé,
//                              zéro appel réseau, zéro donnée sortante.
//   - "openai"    : tout endpoint COMPATIBLE OpenAI — de préférence un modèle
//                   LOCAL (Ollama, LM Studio, vLLM, llama.cpp server, LocalAI).
//   - "anthropic" : strictement OPT-IN (AI_PROVIDER=anthropic + clé fournie).
// Changer de modèle = changer des variables d'environnement, pas le code.
import { streamAnthropic } from "./anthropic";
import { streamOpenAICompatible } from "./openai-compatible";
import { modelFor } from "./prompts";

export type ProviderId = "local" | "openai" | "anthropic";

export type ProviderStatus = {
  provider: ProviderId;
  label: string;
  model: string;
  /** true si le run est simulé par le moteur local déterministe. */
  demo: boolean;
  /** true si des données sortent de la machine vers un service tiers. */
  external: boolean;
  ready: boolean;
  hint?: string;
};

function isLoopback(url: string): boolean {
  return /\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:|\/|$)/i.test(url);
}

/** Résout le fournisseur actif. Ne révèle AUCUN secret (utilisable côté public). */
export function resolveProvider(): ProviderStatus {
  const demo = process.env.DEMO_MODE === "true";
  const asked = (process.env.AI_PROVIDER ?? "local").trim().toLowerCase();

  if (!demo && asked === "anthropic") {
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        provider: "anthropic",
        label: "Anthropic (opt-in explicite)",
        model: modelFor("agent"),
        demo: false,
        external: true,
        ready: true,
      };
    }
    return localStatus("AI_PROVIDER=anthropic sans clé → repli sur le moteur local.");
  }

  if (!demo && asked === "openai") {
    const base = process.env.OPENAI_BASE_URL ?? "";
    if (base) {
      const local = isLoopback(base);
      return {
        provider: "openai",
        label: local
          ? "Modèle local (API compatible OpenAI)"
          : "Endpoint compatible OpenAI",
        model: modelFor("agent"),
        demo: false,
        external: !local,
        ready: true,
      };
    }
    return localStatus("AI_PROVIDER=openai sans OPENAI_BASE_URL → repli sur le moteur local.");
  }

  return localStatus();
}

function localStatus(hint?: string): ProviderStatus {
  return {
    provider: "local",
    label: "Moteur local CORTEXP — exécution réelle",
    model: "cortexp-local",
    demo: false, // le moteur local EXÉCUTE réellement les tâches (VM, stats, web…)
    external: false,
    ready: true,
    hint,
  };
}

/**
 * Flux de génération unifié. Pour "local", ce générateur ne produit rien :
 * le moteur déterministe de engine.ts prend alors le relais (aucune
 * dépendance externe). Les erreurs réseau y sont également rattrapées.
 */
export async function* streamCompletion(
  mode: "agent" | "kingly",
  objective: string,
  history: { role: string; content: string }[]
): AsyncGenerator<string> {
  const p = resolveProvider();
  if (p.provider === "anthropic") yield* streamAnthropic(mode, objective, history);
  else if (p.provider === "openai") yield* streamOpenAICompatible(mode, objective, history);
}

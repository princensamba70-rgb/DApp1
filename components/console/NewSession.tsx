"use client";

// Nouvelle session : saisit l'objectif, crée la session côté API, stocke le
// premier message en attente, puis ouvre la console qui l'exécute aussitôt.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Composer from "./Composer";

const EXAMPLES = [
  { mode: "agent" as const, text: "Crée un script Python qui analyse un CSV de ventes et produit un rapport markdown avec les totaux par région." },
  { mode: "agent" as const, text: "Écris une page web responsive de portfolio avec un thème sombre et anime les sections au scroll." },
  { mode: "kingly" as const, text: "Analyse l'architecture et la sécurité de ce dépôt, produis un rapport d'audit avec sévérités et correctifs." },
  { mode: "kingly" as const, text: "Fais une recherche approfondie sur les bases de données vectorielles et produis un rapport comparatif cité." },
];

export default function NewSession({
  defaultMode,
  displayName,
}: {
  defaultMode: "agent" | "kingly";
  displayName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"agent" | "kingly">(defaultMode);
  const [creating, setCreating] = useState(false);

  async function start(text: string, m: "agent" | "kingly" = mode) {
    setCreating(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: m }),
    });
    if (!res.ok) {
      setCreating(false);
      return;
    }
    const { session } = await res.json();
    sessionStorage.setItem(`cortexp:pending:${session.id}`, JSON.stringify({ content: text, mode: m }));
    window.dispatchEvent(new Event("cortexp:sessions-changed"));
    router.push(`/c/${session.id}`);
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center font-mono">
          <div className="text-xs text-fg-2 mb-2">~/cortexp/nouvelle-session $</div>
          <h1 className="text-2xl font-bold">
            Bonjour, <span className={mode === "kingly" ? "text-king" : "text-accent"}>{displayName}</span>
          </h1>
          <p className="text-fg-1 text-sm mt-1">Donne un objectif. Récupère un livrable.</p>
        </div>

        <Composer mode={mode} onModeChange={setMode} onSend={(t) => start(t)} disabled={creating} />

        <div className="grid sm:grid-cols-2 gap-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => start(ex.text, ex.mode)}
              disabled={creating}
              className="text-left border border-line rounded-lg bg-bg-1 p-3 font-mono text-xs text-fg-1 hover:text-fg-0 hover:border-accent/60 transition-colors disabled:opacity-50"
            >
              <span className={ex.mode === "kingly" ? "text-king" : "text-accent"}>
                {ex.mode === "kingly" ? "♛ kingly" : "◇ agent"}
              </span>
              <p className="mt-1 line-clamp-2">{ex.text}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

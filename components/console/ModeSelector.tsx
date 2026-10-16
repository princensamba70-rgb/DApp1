"use client";

// Sélecteur segmenté [ AGENT | KINGLY 1 ] — change l'accent et le contexte.
export default function ModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: "agent" | "kingly";
  onChange: (m: "agent" | "kingly") => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex font-mono text-xs border border-line rounded-lg overflow-hidden" role="tablist">
      <button
        role="tab"
        aria-selected={mode === "agent"}
        disabled={disabled}
        onClick={() => onChange("agent")}
        title="Agent autonome polyvalent : rapide, direct, 1 IA"
        className={`px-4 py-1.5 transition-colors ${
          mode === "agent" ? "bg-accent text-bg-0 font-semibold" : "text-fg-1 hover:text-fg-0"
        }`}
      >
        ◇ AGENT
      </button>
      <button
        role="tab"
        aria-selected={mode === "kingly"}
        disabled={disabled}
        onClick={() => onChange("kingly")}
        title="Kingly 1 — analyse multi-agents, profondeur maximale, audit complet"
        className={`px-4 py-1.5 transition-colors ${
          mode === "kingly" ? "bg-king text-bg-0 font-semibold" : "text-fg-1 hover:text-fg-0"
        }`}
      >
        ♛ KINGLY 1
      </button>
    </div>
  );
}

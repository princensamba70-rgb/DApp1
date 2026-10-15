"use client";

import { useRef } from "react";
import ModeSelector from "./ModeSelector";

export default function Composer({
  mode,
  onModeChange,
  onSend,
  disabled,
  placeholder = "▷ Décris ton objectif…  (⌘⏎ / Ctrl+⏎ pour envoyer)",
}: {
  mode: "agent" | "kingly";
  onModeChange: (m: "agent" | "kingly") => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = ref.current?.value.trim();
    if (!text || disabled) return;
    if (ref.current) ref.current.value = "";
    onSend(text);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <ModeSelector mode={mode} onChange={onModeChange} disabled={disabled} />
        {mode === "kingly" && (
          <span className="font-mono text-[11px] text-king hidden sm:block">
            Kingly 1 — multi-agents, profondeur maximale, audit complet
          </span>
        )}
      </div>
      <div
        className={`border rounded-xl bg-bg-1 transition-colors focus-within:border-opacity-100 ${
          mode === "kingly" ? "border-king/50 focus-within:border-king" : "border-line focus-within:border-accent"
        }`}
      >
        <textarea
          ref={ref}
          rows={3}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Objectif"
          className="w-full bg-transparent px-4 py-3 font-mono text-sm text-fg-0 placeholder:text-fg-2 resize-none focus:outline-none disabled:opacity-50"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="font-mono text-[10px] text-fg-2">
            mode : {mode === "kingly" ? "kingly 1 ♛" : "agent ◇"}
          </span>
          <button
            onClick={submit}
            disabled={disabled}
            className={`px-4 py-1.5 rounded-lg font-mono text-xs font-semibold text-bg-0 transition-opacity hover:opacity-90 disabled:opacity-40 ${
              mode === "kingly" ? "bg-king" : "bg-accent"
            }`}
          >
            {disabled ? "exécution…" : "Exécuter ⏎"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ToolCallInfo } from "@/lib/agent/types";

const ICONS: Record<string, string> = {
  bash: "❯",
  fs_write: "✎",
  fs_edit: "±",
  python: "λ",
  web_search: "⌕",
};

export default function ToolCallCard({ call }: { call: ToolCallInfo }) {
  const [open, setOpen] = useState(false);
  const running = call.ok === undefined;
  const exitColor =
    call.exitCode === undefined ? "text-fg-2" : call.exitCode === 0 ? "text-ok" : "text-err";

  return (
    <div className="border border-line rounded-lg bg-bg-1 font-mono text-xs overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-2 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-accent w-4 text-center">{ICONS[call.name] ?? "⚙"}</span>
        <span className="text-fg-1">{call.name}</span>
        <span className="flex-1 truncate text-fg-0">{call.summary}</span>
        {running ? (
          <span className="text-warn animate-pulse">●</span>
        ) : (
          <>
            {call.exitCode !== undefined && (
              <span className={exitColor}>exit {call.exitCode}</span>
            )}
            {call.durationMs !== undefined && (
              <span className="text-fg-2">{call.durationMs} ms</span>
            )}
          </>
        )}
        <span className="text-fg-2">{open ? "▾" : "▸"}</span>
      </button>
      {open && call.output && (
        <pre className="border-t border-line bg-bg-0 px-3 py-2 overflow-x-auto whitespace-pre-wrap text-fg-1 max-h-60 overflow-y-auto">
          {call.output}
        </pre>
      )}
    </div>
  );
}

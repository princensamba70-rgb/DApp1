"use client";

import type { PlanStep } from "@/lib/agent/types";

const STATUS_ICON: Record<PlanStep["status"], { icon: string; cls: string }> = {
  pending: { icon: "○", cls: "text-fg-2" },
  in_progress: { icon: "◐", cls: "text-warn animate-pulse" },
  done: { icon: "●", cls: "text-ok" },
  failed: { icon: "✗", cls: "text-err" },
};

export default function PlanCard({ steps, kingly }: { steps: PlanStep[]; kingly?: boolean }) {
  if (!steps.length) return null;
  const done = steps.filter((s) => s.status === "done").length;

  return (
    <div className="border border-line rounded-lg bg-bg-1 font-mono text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <span className={kingly ? "text-king" : "text-accent"}>
          ⚙ Plan {kingly ? "— phases Kingly 1" : ""}
        </span>
        <span className="text-fg-2">
          {done}/{steps.length}
        </span>
      </div>
      <ol className="p-2 space-y-1" aria-live="polite">
        {steps.map((s) => {
          const st = STATUS_ICON[s.status];
          return (
            <li key={s.id} className="flex items-start gap-2 px-1 py-0.5">
              <span className={st.cls}>{st.icon}</span>
              <span className={s.status === "done" ? "text-fg-1" : "text-fg-0"}>
                {s.title}
                {s.subagentRole && (
                  <span className="text-king/80 ml-2">[{s.subagentRole}]</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

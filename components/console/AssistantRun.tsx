"use client";

// Rendu d'un run assistant : réflexion repliable, plan vivant, appels d'outils,
// sous-agents / citations (Kingly), réponse markdown en streaming.
import { useState } from "react";
import type { CitationInfo, PlanStep, SubAgentInfo, ToolCallInfo } from "@/lib/agent/types";
import PlanCard from "./PlanCard";
import ToolCallCard from "./ToolCallCard";
import Markdown from "./Markdown";

export type RunView = {
  mode: "agent" | "kingly";
  thinking: string;
  plan: PlanStep[];
  tools: ToolCallInfo[];
  subagents: SubAgentInfo[];
  citations: CitationInfo[];
  content: string;
  streaming?: boolean;
};

export default function AssistantRun({ run }: { run: RunView }) {
  const [showThinking, setShowThinking] = useState(false);
  const kingly = run.mode === "kingly";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className={kingly ? "text-king" : "text-accent"}>{kingly ? "♛" : "◇"}</span>
        <span className="text-fg-2">cortexp · mode {kingly ? "kingly 1" : "agent"}</span>
      </div>

      {run.thinking && (
        <div className="font-mono text-xs">
          <button
            onClick={() => setShowThinking((s) => !s)}
            className="text-fg-2 hover:text-fg-1 transition-colors"
            aria-expanded={showThinking}
          >
            {showThinking ? "▾" : "▸"} réflexion
          </button>
          {showThinking && (
            <p className="mt-1 pl-3 border-l border-line text-fg-2 italic">{run.thinking}</p>
          )}
        </div>
      )}

      {run.plan.length > 0 && <PlanCard steps={run.plan} kingly={kingly} />}

      {run.subagents.length > 0 && (
        <div className="border border-line rounded-lg bg-bg-1 font-mono text-xs p-2 space-y-1">
          <div className="text-king px-1">♛ Sous-agents</div>
          {run.subagents.map((sa) => (
            <div key={sa.id} className="flex items-center gap-2 px-1">
              <span className="text-king/70">▸</span>
              <span className="text-fg-0">{sa.role}</span>
              <span className="text-fg-2 flex-1 text-right">{sa.status}</span>
            </div>
          ))}
        </div>
      )}

      {run.tools.map((t) => (
        <ToolCallCard key={t.callId} call={t} />
      ))}

      {(run.content || run.streaming) && (
        <div
          className={`border border-line rounded-lg bg-bg-1 px-4 py-3 ${run.streaming ? "cursor-blink" : ""}`}
          aria-live="polite"
        >
          <Markdown content={run.content} />
        </div>
      )}

      {run.citations.length > 0 && (
        <div className="border border-line rounded-lg bg-bg-1 font-mono text-xs p-2 space-y-1">
          <div className="text-info px-1">⌕ Sources</div>
          {run.citations.map((c, i) => (
            <div key={i} className="px-1">
              <a href={c.url} target="_blank" rel="noreferrer" className="text-info hover:underline">
                {c.title}
              </a>
              <span className="text-fg-2"> — « {c.quote} »</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

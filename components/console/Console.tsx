"use client";

// Console principale : fil d'agent, streaming SSE, composer, barre de statut.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, RunMeta } from "@/lib/agent/types";
import AssistantRun, { type RunView } from "./AssistantRun";
import Composer from "./Composer";

type StoredMessage = { id: string; role: string; content: string; meta?: string | null };
type Entry =
  | { kind: "user"; id: string; content: string }
  | { kind: "run"; id: string; run: RunView };

function metaToRun(content: string, metaJson?: string | null): RunView {
  let meta: Partial<RunMeta> = {};
  try {
    meta = metaJson ? (JSON.parse(metaJson) as RunMeta) : {};
  } catch {}
  return {
    mode: (meta.mode as "agent" | "kingly") ?? "agent",
    thinking: meta.thinking ?? "",
    plan: meta.plan ?? [],
    tools: meta.tools ?? [],
    subagents: meta.subagents ?? [],
    citations: meta.citations ?? [],
    content,
  };
}

export default function Console({
  sessionId,
  initialMessages,
  initialMode,
}: {
  sessionId: string;
  initialMessages: StoredMessage[];
  initialMode: "agent" | "kingly";
}) {
  const [entries, setEntries] = useState<Entry[]>(() =>
    initialMessages.map((m) =>
      m.role === "user"
        ? { kind: "user", id: m.id, content: m.content }
        : { kind: "run", id: m.id, run: metaToRun(m.content, m.meta) }
    )
  );
  const [mode, setMode] = useState<"agent" | "kingly">(initialMode);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState({ model: "—", tokens: 0, cost: 0 });
  const bottomRef = useRef<HTMLDivElement>(null);
  const autostartDone = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, running]);

  const send = useCallback(
    async (text: string, forcedMode?: "agent" | "kingly") => {
      const m = forcedMode ?? mode;
      if (forcedMode) setMode(forcedMode);
      setError(null);
      setRunning(true);
      const userId = `u-${Date.now()}`;
      const runId = `r-${Date.now()}`;
      const run: RunView = {
        mode: m,
        thinking: "",
        plan: [],
        tools: [],
        subagents: [],
        citations: [],
        content: "",
        streaming: true,
      };
      setEntries((e) => [...e, { kind: "user", id: userId, content: text }, { kind: "run", id: runId, run }]);

      const patch = (fn: (r: RunView) => RunView) =>
        setEntries((es) =>
          es.map((en) => (en.kind === "run" && en.id === runId ? { ...en, run: fn(en.run) } : en))
        );

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, content: text, mode: m }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? `Erreur ${res.status}`);
          setEntries((es) => es.filter((en) => en.id !== runId));
          setRunning(false);
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let evt: AgentEvent;
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            switch (evt.t) {
              case "run_start":
                setStatus((s) => ({ ...s, model: evt.model }));
                break;
              case "thinking_delta":
                patch((r) => ({ ...r, thinking: r.thinking + evt.text }));
                break;
              case "plan_update":
                patch((r) => ({ ...r, plan: evt.steps }));
                break;
              case "todo_update":
                patch((r) => ({
                  ...r,
                  plan: r.plan.map((s) => (s.id === evt.id ? { ...s, status: evt.status } : s)),
                }));
                break;
              case "tool_start":
                patch((r) => ({ ...r, tools: [...r.tools, evt.call] }));
                break;
              case "tool_end":
                patch((r) => ({
                  ...r,
                  tools: r.tools.map((t) =>
                    t.callId === evt.callId
                      ? { ...t, ok: evt.ok, exitCode: evt.exitCode, durationMs: evt.durationMs, output: evt.output }
                      : t
                  ),
                }));
                break;
              case "subagent_update":
                patch((r) => {
                  const exists = r.subagents.some((s) => s.id === evt.id);
                  return {
                    ...r,
                    subagents: exists
                      ? r.subagents.map((s) => (s.id === evt.id ? { ...s, status: evt.status } : s))
                      : [...r.subagents, { id: evt.id, role: evt.role, status: evt.status }],
                  };
                });
                break;
              case "citation":
                patch((r) => ({ ...r, citations: [...r.citations, { url: evt.url, title: evt.title, quote: evt.quote }] }));
                break;
              case "content_delta":
                patch((r) => ({ ...r, content: r.content + evt.text }));
                break;
              case "usage":
                setStatus((s) => ({ ...s, tokens: evt.tokensIn + evt.tokensOut, cost: evt.costUsd }));
                break;
              case "error":
                setError(evt.message);
                break;
              case "run_end":
                patch((r) => ({ ...r, streaming: false }));
                break;
            }
          }
        }
      } catch {
        setError("Connexion interrompue pendant le run.");
      } finally {
        patch((r) => ({ ...r, streaming: false }));
        setRunning(false);
        window.dispatchEvent(new Event("cortexp:sessions-changed"));
      }
    },
    [mode, sessionId]
  );

  // Premier message mis en attente par la page « nouvelle session »
  useEffect(() => {
    if (autostartDone.current) return;
    autostartDone.current = true;
    const key = `cortexp:pending:${sessionId}`;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      sessionStorage.removeItem(key);
      try {
        const { content, mode: m } = JSON.parse(raw);
        void send(content, m === "kingly" ? "kingly" : "agent");
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {entries.length === 0 && (
            <div className="text-center font-mono text-fg-2 text-sm pt-16">
              <p className="text-2xl mb-2">{mode === "kingly" ? "♛" : "◇"}</p>
              <p>Décris ton objectif. L&apos;agent planifie, exécute, se corrige et livre.</p>
            </div>
          )}
          {entries.map((e) =>
            e.kind === "user" ? (
              <div key={e.id} className="flex justify-end">
                <div className="max-w-[85%] border border-line rounded-xl bg-bg-2 px-4 py-2.5 font-mono text-sm whitespace-pre-wrap">
                  {e.content}
                </div>
              </div>
            ) : (
              <AssistantRun key={e.id} run={e.run} />
            )
          )}
          {error && (
            <div className="border border-err/40 bg-err/10 rounded-lg px-4 py-2.5 font-mono text-xs text-err" role="alert">
              ✗ {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-bg-0 px-4 lg:px-8 py-3">
        <div className="max-w-3xl mx-auto">
          <Composer mode={mode} onModeChange={setMode} onSend={send} disabled={running} />
        </div>
      </div>

      <div className="border-t border-line bg-bg-1 px-4 py-1.5 font-mono text-[10px] text-fg-2 flex items-center gap-4 overflow-x-auto">
        <span className="flex items-center gap-1.5">
          <span className={running ? "text-warn animate-pulse" : "text-ok"}>●</span>
          {running ? "run en cours" : "sandbox prêt"}
        </span>
        <span>{status.model}</span>
        <span>{status.tokens.toLocaleString("fr-FR")} tok</span>
        <span>{status.cost.toFixed(4)} $</span>
        <span className="ml-auto hidden sm:block">⌘⏎ envoyer · mode {mode}</span>
      </div>
    </div>
  );
}

"use client";

// Espace de travail (colonne de droite) : fichiers générés par l'agent,
// téléchargement ZIP, aperçu du site dans la console, et terminal confiné
// (ls, cat, git… réellement exécutés côté serveur dans le workspace).
import { useCallback, useEffect, useRef, useState } from "react";

type WsFile = { name: string; size: number };
type TermLine = { cmd?: string; text: string; err?: boolean };

const QUICK = ["ls", "git init", "git status", "git add .", 'git commit -m "premier commit"', "git log --oneline"];

export default function WorkspacePanel({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<WsFile[]>([]);
  const [tab, setTab] = useState<"fichiers" | "apercu" | "terminal">("fichiers");
  const [lines, setLines] = useState<TermLine[]>([]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/sessions/${sessionId}/artifacts`);
      if (r.ok) setFiles(((await r.json()) as { files?: WsFile[] }).files ?? []);
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    const t = setTimeout(refresh, 0);
    const h = () => refresh();
    window.addEventListener("cortexp:sessions-changed", h);
    return () => {
      clearTimeout(t);
      window.removeEventListener("cortexp:sessions-changed", h);
    };
  }, [refresh]);

  useEffect(() => {
    logRef.current?.scrollTo(0, 1e9);
  }, [lines]);

  async function run(c: string) {
    const command = c.trim();
    if (!command || busy) return;
    setBusy(true);
    setCmd("");
    try {
      const r = await fetch(`/api/sessions/${sessionId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const d = (await r.json()) as { stdout?: string; stderr?: string; exitCode?: number; error?: string };
      const out: TermLine[] = [{ cmd: command, text: "" }];
      if (d.error) out.push({ text: d.error, err: true });
      if (d.stdout) out.push({ text: d.stdout });
      if (d.stderr) out.push({ text: d.stderr, err: true });
      out.push({ text: `↳ exit ${d.exitCode ?? "?"}`, err: (d.exitCode ?? 0) !== 0 });
      setLines((l) => [...l.slice(-120), ...out]);
      refresh();
    } catch {
      setLines((l) => [...l, { cmd: command, text: "" }, { text: "erreur réseau", err: true }]);
    } finally {
      setBusy(false);
    }
  }

  const hasIndex = files.some((f) => f.name === "index.html");
  const tabCls = (t: typeof tab) =>
    `flex-1 py-1.5 text-[11px] uppercase tracking-wide transition-colors ${
      tab === t ? "bg-bg-2 text-fg-0 font-semibold" : "text-fg-2 hover:text-fg-0"
    }`;

  return (
    <aside className="hidden xl:flex w-[360px] shrink-0 border-l border-line bg-bg-1 flex-col font-mono min-h-0">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <span className="text-xs font-semibold text-fg-0">⌂ Espace de travail</span>
        {files.length > 0 && (
          <a
            href={`/api/sessions/${sessionId}/archive`}
            className="text-[11px] bg-accent text-bg-0 rounded-md px-2.5 py-1 font-semibold hover:opacity-90 transition-opacity"
            download
          >
            ↓ ZIP complet
          </a>
        )}
      </div>

      <div className="flex border-b border-line" role="tablist">
        <button role="tab" aria-selected={tab === "fichiers"} className={tabCls("fichiers")} onClick={() => setTab("fichiers")}>
          Fichiers ({files.length})
        </button>
        <button role="tab" aria-selected={tab === "apercu"} className={tabCls("apercu")} onClick={() => setTab("apercu")} disabled={!hasIndex}>
          Aperçu
        </button>
        <button role="tab" aria-selected={tab === "terminal"} className={tabCls("terminal")} onClick={() => setTab("terminal")}>
          Terminal
        </button>
      </div>

      {tab === "fichiers" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs">
          {files.length === 0 && (
            <p className="text-fg-2 leading-relaxed p-2">
              Les fichiers générés par l&apos;agent (sites, API, scripts) apparaîtront ici.
              Demande par exemple : «&nbsp;Crée un site vitrine pour…&nbsp;»
            </p>
          )}
          {files.map((f) => (
            <div key={f.name} className="flex items-center justify-between border border-line rounded-lg bg-bg-0 px-3 py-2">
              <span className="truncate text-fg-0">{f.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-fg-2 text-[10px]">{(f.size / 1024).toFixed(1)} Ko</span>
                <a className="text-accent hover:underline" href={`/api/sessions/${sessionId}/artifacts/${f.name}`} download>
                  ↓
                </a>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "apercu" &&
        (hasIndex ? (
          <iframe
            key={files.length}
            title="Aperçu du projet généré"
            sandbox="allow-same-origin allow-scripts"
            src={`/api/sessions/${sessionId}/artifacts/index.html?inline=1`}
            className="flex-1 w-full bg-white"
          />
        ) : (
          <p className="p-4 text-xs text-fg-2">Aucun index.html à prévisualiser.</p>
        ))}

      {tab === "terminal" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 text-[11px] leading-relaxed space-y-0.5">
            {lines.length === 0 && (
              <p className="text-fg-2">
                Terminal confiné au workspace — commandes réellement exécutées
                (ls, cat, head, wc, echo, git init/add/commit/log/diff…).
              </p>
            )}
            {lines.map((l, i) =>
              l.cmd !== undefined ? (
                <div key={i} className="text-accent pt-1.5">$ {l.cmd}</div>
              ) : (
                <pre key={i} className={`whitespace-pre-wrap break-words ${l.err ? "text-err" : "text-fg-1"}`}>{l.text}</pre>
              )
            )}
          </div>
          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} onClick={() => run(q)} disabled={busy}
                className="text-[10px] border border-line rounded-full px-2 py-0.5 text-fg-2 hover:text-fg-0 hover:border-fg-2 transition-colors disabled:opacity-40">
                {q}
              </button>
            ))}
          </div>
          <form
            className="border-t border-line flex items-center gap-2 px-3 py-2"
            onSubmit={(e) => { e.preventDefault(); run(cmd); }}
          >
            <span className="text-accent text-xs">$</span>
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder={busy ? "exécution…" : "ls, git status, cat index.html…"}
              aria-label="Commande du terminal"
              className="flex-1 bg-transparent text-xs text-fg-0 placeholder:text-fg-2 focus:outline-none"
              disabled={busy}
            />
          </form>
        </div>
      )}
    </aside>
  );
}

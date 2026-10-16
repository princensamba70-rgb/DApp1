"use client";

// Espace de travail du projet actif — panneau droit de la console.
// Onglets : Aperçu (iframe sandboxée), Fichiers (arborescence + vue code),
// Terminal (commandes réellement exécutées côté serveur, confinées), Git
// (actions rapides sur le dépôt du workspace), Projets (liste, renommage,
// ouverture, téléchargement ZIP). Redimensionnable à la souris sur grand
// écran, accessible en panneau plein écran sur mobile.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type WsFile = { name: string; size: number; mtime: number };
type TermLine = { cmd?: string; text: string; err?: boolean; meta?: string };
type Project = { id: string; title: string; createdAt: string; updatedAt: string; fileCount: number; totalSize: number };
type Tab = "apercu" | "fichiers" | "terminal" | "git" | "projets";

const QUICK = ["ls", "find .", "git status", "git log --oneline", "npm install"];
const TABS: { id: Tab; label: string }[] = [
  { id: "apercu", label: "Aperçu" },
  { id: "fichiers", label: "Fichiers" },
  { id: "terminal", label: "Terminal" },
  { id: "git", label: "Git" },
  { id: "projets", label: "Projets" },
];

function fmtSize(n: number) {
  return n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
function fmtDate(d: string | number) {
  return new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default function WorkspacePanel({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<WsFile[]>([]);
  const [tab, setTab] = useState<Tab>("fichiers");
  const [lines, setLines] = useState<TermLine[]>([]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [openFile, setOpenFile] = useState<{ name: string; content: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [width, setWidth] = useState(400);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/sessions/${sessionId}/artifacts`);
      if (r.ok) setFiles(((await r.json()) as { files?: WsFile[] }).files ?? []);
    } catch {}
  }, [sessionId]);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects`);
      if (r.ok) setProjects(((await r.json()) as { projects?: Project[] }).projects ?? []);
    } catch {}
  }, []);

  // Largeur persistée + historique terminal de la session
  useEffect(() => {
    const t = setTimeout(() => {
      const w = Number(localStorage.getItem("cortexp:ws-width"));
      if (w >= 320 && w <= 900) setWidth(w);
      try {
        const h = sessionStorage.getItem(`cortexp:term:${sessionId}`);
        if (h) setLines(JSON.parse(h) as TermLine[]);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [sessionId]);

  useEffect(() => {
    const t = setTimeout(() => {
      refresh();
      loadProjects();
    }, 0);
    const h = () => {
      refresh();
      loadProjects();
      setPreviewKey((k) => k + 1);
    };
    window.addEventListener("cortexp:sessions-changed", h);
    return () => {
      clearTimeout(t);
      window.removeEventListener("cortexp:sessions-changed", h);
    };
  }, [refresh, loadProjects]);

  useEffect(() => {
    logRef.current?.scrollTo(0, 1e9);
    try {
      sessionStorage.setItem(`cortexp:term:${sessionId}`, JSON.stringify(lines.slice(-150)));
    } catch {}
  }, [lines, sessionId]);

  // Redimensionnement par glissement de la poignée gauche
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const w = Math.min(900, Math.max(320, window.innerWidth - e.clientX));
      setWidth(w);
    };
    const up = () => {
      if (dragging.current) {
        dragging.current = false;
        setWidth((w) => {
          localStorage.setItem("cortexp:ws-width", String(w));
          return w;
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

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
      const d = (await r.json()) as { stdout?: string; stderr?: string; exitCode?: number; durationMs?: number; error?: string };
      const out: TermLine[] = [{ cmd: command, text: "" }];
      if (d.error) out.push({ text: d.error, err: true });
      if (d.stdout) out.push({ text: d.stdout });
      if (d.stderr) out.push({ text: d.stderr, err: true });
      out.push({
        text: "",
        meta: `exit ${d.exitCode ?? "?"} · ${((d.durationMs ?? 0) / 1000).toFixed(2)} s`,
        err: (d.exitCode ?? 0) !== 0,
      });
      setLines((l) => [...l.slice(-140), ...out]);
      refresh();
    } catch {
      setLines((l) => [...l, { cmd: command, text: "" }, { text: "erreur réseau", err: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function viewFile(name: string) {
    try {
      const r = await fetch(`/api/sessions/${sessionId}/artifacts/${name}?raw=1`);
      if (r.ok) {
        setOpenFile({ name, content: await r.text() });
      }
    } catch {}
  }

  async function renameProject(id: string, title: string) {
    const t = title.trim();
    setRenaming(null);
    if (!t) return;
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    loadProjects();
    window.dispatchEvent(new Event("cortexp:sessions-changed"));
  }

  const hasIndex = files.some((f) => f.name === "index.html");
  const gitReady = lines.length > 0 || files.length > 0;

  const panel = (
    <div className="h-full flex flex-col bg-bg-1 min-h-0">
      {/* En-tête + onglets */}
      <div className="border-b border-line px-3 pt-2.5 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-fg-2">Espace de travail</span>
          <div className="flex items-center gap-2">
            {files.length > 0 && (
              <a
                href={`/api/sessions/${sessionId}/archive`}
                className="font-mono text-[11px] px-2 py-1 rounded border border-line text-fg-1 hover:text-fg-0 hover:border-accent transition-colors"
                title="Télécharger le projet complet (ZIP) — secrets et node_modules exclus"
              >
                ↓ ZIP complet
              </a>
            )}
            <button
              onClick={() => setMobileOpen(false)}
              className="xl:hidden font-mono text-[13px] text-fg-2 hover:text-fg-0 px-1"
              aria-label="Fermer l'espace de travail"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "projets") loadProjects();
                if (t.id === "apercu") setPreviewKey((k) => k + 1);
              }}
              className={`font-mono text-[11px] px-2.5 py-1.5 rounded-t border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id ? "border-accent text-fg-0" : "border-transparent text-fg-2 hover:text-fg-1"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === "fichiers" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className={`${openFile ? "max-h-40" : "flex-1"} overflow-y-auto px-2 py-2 shrink-0`}>
              {files.length === 0 ? (
                <p className="text-fg-2 text-xs px-2 py-4">
                  Aucun fichier généré pour l&apos;instant. Demandez à l&apos;agent de créer un site ou un projet :
                  les fichiers apparaîtront ici.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {files.map((f) => {
                    const depth = f.name.split("/").length - 1;
                    return (
                      <li key={f.name} className="flex items-center gap-1.5 group" style={{ paddingLeft: depth * 12 }}>
                        <button
                          onClick={() => viewFile(f.name)}
                          className={`flex-1 text-left font-mono text-xs px-2 py-1 rounded hover:bg-bg-2 transition-colors truncate ${
                            openFile?.name === f.name ? "text-accent" : "text-fg-1 hover:text-fg-0"
                          }`}
                          title={`${f.name} — modifié le ${fmtDate(f.mtime)}`}
                        >
                          {f.name}
                        </button>
                        <span className="font-mono text-[10px] text-fg-2 shrink-0">{fmtSize(f.size)}</span>
                        <a
                          href={`/api/sessions/${sessionId}/artifacts/${f.name}`}
                          download
                          className="font-mono text-[11px] text-fg-2 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pr-1"
                          title="Télécharger ce fichier"
                        >
                          ↓
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {openFile && (
              <div className="flex-1 min-h-0 border-t border-line flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 bg-bg-2 shrink-0">
                  <span className="font-mono text-[11px] text-fg-1 truncate">{openFile.name}</span>
                  <button onClick={() => setOpenFile(null)} className="font-mono text-[11px] text-fg-2 hover:text-fg-0">
                    fermer ✕
                  </button>
                </div>
                <pre className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-1 whitespace-pre-wrap break-words">
                  {openFile.content.slice(0, 100_000)}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === "apercu" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-line shrink-0">
              <span className="font-mono text-[11px] text-fg-2">{hasIndex ? "index.html — aperçu isolé" : "aperçu"}</span>
              <button
                onClick={() => setPreviewKey((k) => k + 1)}
                className="font-mono text-[11px] text-fg-1 hover:text-accent"
                title="Recharger l'aperçu après une modification"
              >
                ⟳ actualiser
              </button>
            </div>
            {hasIndex ? (
              <iframe
                key={previewKey}
                src={`/api/sessions/${sessionId}/artifacts/index.html?inline=1`}
                sandbox="allow-same-origin allow-scripts"
                className="flex-1 w-full bg-white"
                title="Aperçu du projet"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center px-6">
                <p className="text-fg-2 text-xs leading-relaxed max-w-[28ch] text-center">
                  {files.length === 0
                    ? "Aucun projet généré dans cette session."
                    : "Ce projet n'a pas de page index.html : il nécessite une exécution serveur. Téléchargez le ZIP, puis suivez le README (ex. npm install puis node server.js)."}
                </p>
              </div>
            )}
          </div>
        )}

        {(tab === "terminal" || tab === "git") && (
          <div className="flex-1 min-h-0 flex flex-col">
            {tab === "git" && (
              <div className="px-3 py-2 border-b border-line space-y-2 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {["git init", "git status", "git log --oneline", "git diff", "git branch"].map((c) => (
                    <button
                      key={c}
                      onClick={() => run(c)}
                      disabled={busy}
                      className="font-mono text-[10px] px-2 py-1 rounded border border-line text-fg-1 hover:border-accent hover:text-fg-0 disabled:opacity-40 transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const m = commitMsg.trim() || "mise à jour";
                    setCommitMsg("");
                    run("git add .").then(() => run(`git commit -m "${m.replace(/"/g, "'")}"`));
                  }}
                >
                  <input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="message de commit…"
                    className="flex-1 bg-bg-2 border border-line rounded px-2 py-1 font-mono text-[11px] text-fg-0 placeholder:text-fg-2 focus:border-accent focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy || !gitReady}
                    className="font-mono text-[10px] px-2.5 py-1 rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
                  >
                    add + commit
                  </button>
                </form>
              </div>
            )}
            <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
              {lines.length === 0 && (
                <p className="text-fg-2">
                  Terminal confiné au projet de cette session — commandes réellement exécutées
                  (ls, cat, grep, find, mkdir, cp, mv, git, npm install…).
                </p>
              )}
              {lines.map((l, i) =>
                l.cmd !== undefined ? (
                  <div key={i} className="text-fg-0 mt-2">
                    <span className="text-accent">$</span> {l.cmd}
                  </div>
                ) : l.meta ? (
                  <div key={i} className={`text-[10px] ${l.err ? "text-err" : "text-fg-2"}`}>↳ {l.meta}</div>
                ) : (
                  <pre key={i} className={`whitespace-pre-wrap break-words ${l.err ? "text-err" : "text-fg-1"}`}>
                    {l.text}
                  </pre>
                )
              )}
              {busy && <div className="text-fg-2 animate-pulse mt-1">exécution…</div>}
            </div>
            <div className="border-t border-line px-2 py-1.5 shrink-0">
              {tab === "terminal" && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      onClick={() => run(q)}
                      disabled={busy}
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-line text-fg-2 hover:text-fg-0 hover:border-accent disabled:opacity-40 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(cmd);
                }}
              >
                <span className="font-mono text-xs text-accent shrink-0">$</span>
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  disabled={busy}
                  placeholder={busy ? "exécution…" : "commande (ls, cat index.html, git status…)"}
                  className="flex-1 bg-transparent font-mono text-xs text-fg-0 placeholder:text-fg-2 focus:outline-none"
                />
              </form>
            </div>
          </div>
        )}

        {tab === "projets" && (
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {projects.length === 0 ? (
              <p className="text-fg-2 text-xs px-2 py-4">Aucun projet généré pour l&apos;instant.</p>
            ) : (
              <ul className="space-y-1.5">
                {projects.map((p) => (
                  <li key={p.id} className={`rounded border px-2.5 py-2 ${p.id === sessionId ? "border-accent/50 bg-accent/5" : "border-line"}`}>
                    {renaming?.id === p.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          renameProject(p.id, renaming.title);
                        }}
                        className="flex gap-1.5 mb-1"
                      >
                        <input
                          autoFocus
                          value={renaming.title}
                          onChange={(e) => setRenaming({ id: p.id, title: e.target.value })}
                          onBlur={() => renameProject(p.id, renaming.title)}
                          className="flex-1 bg-bg-2 border border-line rounded px-2 py-0.5 font-mono text-xs text-fg-0 focus:border-accent focus:outline-none"
                        />
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5 mb-1">
                        <button
                          onClick={() => router.push(`/c/${p.id}`)}
                          className="flex-1 text-left font-mono text-xs text-fg-0 hover:text-accent truncate transition-colors"
                          title="Ouvrir ce projet"
                        >
                          {p.title}
                        </button>
                        <button
                          onClick={() => setRenaming({ id: p.id, title: p.title })}
                          className="font-mono text-[10px] text-fg-2 hover:text-fg-0"
                          title="Renommer"
                        >
                          ✎
                        </button>
                        <a
                          href={`/api/sessions/${p.id}/archive`}
                          className="font-mono text-[10px] text-fg-2 hover:text-accent"
                          title="Télécharger le ZIP"
                        >
                          ↓ ZIP
                        </a>
                      </div>
                    )}
                    <div className="font-mono text-[10px] text-fg-2">
                      {p.fileCount} fichier{p.fileCount > 1 ? "s" : ""} · {fmtSize(p.totalSize)} · créé {fmtDate(p.createdAt)} · modifié {fmtDate(p.updatedAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Grand écran : colonne droite redimensionnable */}
      <aside
        className="hidden xl:flex shrink-0 border-l border-line relative"
        style={{ width }}
        aria-label="Espace de travail du projet"
      >
        <div
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize z-10 hover:bg-accent/40 transition-colors"
          title="Glisser pour redimensionner"
        />
        <div className="flex-1 min-w-0">{panel}</div>
      </aside>

      {/* Mobile/tablette : bouton flottant + panneau plein écran */}
      <button
        onClick={() => setMobileOpen(true)}
        className="xl:hidden fixed bottom-20 right-4 z-40 font-mono text-[11px] px-3 py-2 rounded-full bg-bg-2 border border-line text-fg-1 shadow-lg hover:border-accent hover:text-fg-0 transition-colors"
        aria-label="Ouvrir l'espace de travail"
      >
        ⌥ Workspace{files.length > 0 ? ` (${files.length})` : ""}
      </button>
      {mobileOpen && (
        <div className="xl:hidden fixed inset-0 z-50 bg-bg-0/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-y-0 right-0 w-full sm:w-[420px] border-l border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {panel}
          </div>
        </div>
      )}
    </>
  );
}

// ── Boîte à outils d'EXÉCUTION RÉELLE du moteur local CORTEXP ───────────────
// Chaque compétence effectue un travail réel et vérifiable, sans aucune API
// externe : exécution JavaScript en VM isolée, statistiques CSV, résumé
// extractif, calcul, revue de code statique, validation JSON, lecture web.
// Rien n'est simulé : les sorties proviennent de calculs effectivement réalisés.
import vm from "node:vm";

export type SkillOutcome = {
  name: string;
  summary: string;
  output: string;
  ok: boolean;
  exitCode: number;
  markdown: string;
  citations?: { url: string; title: string; quote: string }[];
};

export type Task =
  | { kind: "js"; code: string }
  | { kind: "json"; raw: string }
  | { kind: "csv"; raw: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "math"; expr: string }
  | { kind: "web"; urls: string[] }
  | { kind: "text"; raw: string };

const cap = (s: string, n = 4000) => (s.length > n ? s.slice(0, n) + "\n… (tronqué)" : s);

// ── Détection des tâches exécutables dans une demande ──────────────────────
const FENCE = /```([\w-]*)\n([\s\S]*?)```/g;

export function detectTasks(objective: string): Task[] {
  const tasks: Task[] = [];
  let rest = objective;

  for (const m of objective.matchAll(FENCE)) {
    const lang = (m[1] || "").toLowerCase();
    const body = m[2].trim();
    rest = rest.replace(m[0], " ");
    if (!body) continue;
    if (["js", "javascript", "node"].includes(lang)) tasks.push({ kind: "js", code: body });
    else if (lang === "json") tasks.push({ kind: "json", raw: body });
    else if (lang === "csv") tasks.push({ kind: "csv", raw: body });
    else if (looksLikeCsv(body)) tasks.push({ kind: "csv", raw: body });
    else tasks.push({ kind: "code", lang: lang || "texte", code: body });
  }

  const urls = [...rest.matchAll(/https?:\/\/[^\s)>'"\]]+/g)].map((m) => m[0]);
  if (urls.length > 0) tasks.push({ kind: "web", urls: urls.slice(0, 3) });
  for (const u of urls) rest = rest.replace(u, " ");

  // Expressions arithmétiques, même noyées dans une phrase :
  // on isole les séquences chiffres/opérateurs et on garde la plus riche.
  const mathCandidates = (rest.replace(/=/g, " ").match(/[\d+\-*/%^().,\s]{3,}/g) ?? [])
    .map((c) => c.trim().replace(/^[^\d(]+/, "").replace(/[^\d)]+$/, ""))
    .filter((c) => /\d\s*[+\-*/%^]\s*\(*\s*\d/.test(c))
    .sort((a, b) => b.length - a.length);
  if (mathCandidates[0]) tasks.push({ kind: "math", expr: mathCandidates[0] });

  const prose = rest.trim();
  if (looksLikeCsv(prose)) tasks.push({ kind: "csv", raw: prose });
  else if (prose.length > 400) tasks.push({ kind: "text", raw: prose });

  return tasks;
}

export function taskLabel(t: Task): string {
  switch (t.kind) {
    case "js": return `Exécuter le bloc JavaScript (${t.code.split("\n").length} lignes, VM isolée)`;
    case "json": return "Valider et formater le document JSON";
    case "csv": return `Analyser le tableau CSV (${t.raw.trim().split("\n").length} lignes)`;
    case "code": return `Revue statique du code ${t.lang} (${t.code.split("\n").length} lignes)`;
    case "math": return `Calculer l'expression « ${t.expr.slice(0, 40)} »`;
    case "web": return `Consulter ${t.urls.length} source(s) web fournie(s)`;
    case "text": return `Résumer et analyser le texte (${t.raw.split(/\s+/).length} mots)`;
  }
}

export async function runTask(t: Task): Promise<SkillOutcome> {
  switch (t.kind) {
    case "js": return runJavaScript(t.code);
    case "json": return validateJson(t.raw);
    case "csv": return analyzeCsv(t.raw);
    case "code": return reviewCode(t.lang, t.code);
    case "math": return evalMath(t.expr);
    case "web": return fetchPages(t.urls);
    case "text": return summarizeText(t.raw);
  }
}

// ── 1. Exécution JavaScript réelle (node:vm, isolée, 2 s max) ──────────────
// Limites assumées : pas de require/process/réseau, timeout strict, sortie
// plafonnée. Le processus tourne déjà sous utilisateur non privilégié.
export function runJavaScript(code: string): SkillOutcome {
  const name = "vm.run_javascript";
  if (code.length > 20_000) {
    return fail(name, "Script refusé : > 20 Ko.", "Réduisez la taille du script.");
  }
  const logs: string[] = [];
  const fmt = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));
  const push = (...a: unknown[]) => { if (logs.length < 200) logs.push(a.map(fmt).join(" ")); };
  const sandbox = {
    console: { log: push, info: push, warn: push, error: push },
    Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp, Map, Set,
    parseInt, parseFloat, isNaN, isFinite, structuredClone,
  };
  const t0 = Date.now();
  try {
    const script = new vm.Script(code, { filename: "cortexp-vm.js" });
    const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    const value = script.runInContext(ctx, { timeout: 2000 });
    const out = [logs.join("\n"), value !== undefined ? `→ valeur : ${fmt(value)}` : ""]
      .filter(Boolean).join("\n") || "(exécution terminée sans sortie)";
    return {
      name, ok: true, exitCode: 0,
      summary: `Script exécuté en ${Date.now() - t0} ms`,
      output: cap(out),
      markdown: `**Exécution JavaScript réelle** (VM isolée, ${Date.now() - t0} ms, exit 0) :\n\`\`\`text\n${cap(out, 2000)}\n\`\`\``,
    };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const out = [logs.join("\n"), msg].filter(Boolean).join("\n");
    return {
      name, ok: false, exitCode: 1,
      summary: "Le script a levé une erreur",
      output: cap(out),
      markdown: `**Exécution JavaScript** (exit 1) — erreur réelle capturée :\n\`\`\`text\n${cap(out, 1200)}\n\`\`\``,
    };
  }
}

// ── 2. Calcul d'expression (validée puis évaluée) ──────────────────────────
export function evalMath(expr: string): SkillOutcome {
  const name = "calc.evaluate";
  const clean = expr.replace(/,/g, ".").replace(/\^/g, "**").replace(/\s+/g, " ").trim();
  if (!/^[\d\s+\-*/%().*]+$/.test(clean)) return fail(name, "Expression non reconnue.", expr);
  try {
    const value = new Function(`"use strict"; return (${clean});`)() as number;
    if (typeof value !== "number" || !isFinite(value)) throw new Error("résultat non fini");
    return {
      name, ok: true, exitCode: 0,
      summary: `Résultat : ${value}`,
      output: `${expr} = ${value}`,
      markdown: `**Calcul réel** : \`${expr.trim()} = ${value}\``,
    };
  } catch {
    return fail(name, "Évaluation impossible.", expr);
  }
}

// ── 3. Statistiques CSV réelles ─────────────────────────────────────────────
function looksLikeCsv(text: string): boolean {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 3) return false;
  const d = (lines[0].match(/,/g) || []).length >= 1 ? "," : (lines[0].match(/;/g) || []).length >= 1 ? ";" : null;
  if (!d) return false;
  const n = lines[0].split(d).length;
  return n >= 2 && lines.slice(0, 6).every((l) => l.split(d).length === n);
}

export function analyzeCsv(raw: string): SkillOutcome {
  const name = "data.csv_stats";
  const lines = raw.trim().split("\n").filter(Boolean);
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const header = lines[0].split(delim).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(delim).map((c) => c.trim()));
  const colStats: string[] = [];
  header.forEach((h, i) => {
    const nums = rows.map((r) => Number((r[i] ?? "").replace(",", "."))).filter((v) => !Number.isNaN(v) && (rows[0]?.[i] ?? "") !== "");
    if (nums.length < Math.max(2, rows.length * 0.6)) return;
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const sorted = [...nums].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    colStats.push(`| ${h} | ${nums.length} | ${r(Math.min(...nums))} | ${r(Math.max(...nums))} | ${r(mean)} | ${r(median)} | ${r(sum)} | ${r(std)} |`);
  });
  const out = `${rows.length} lignes de données, ${header.length} colonnes (${header.join(", ")}) ; ${colStats.length} colonne(s) numérique(s).`;
  const md = colStats.length
    ? `**Analyse CSV réelle** — ${out}\n\n| Colonne | n | min | max | moyenne | médiane | somme | écart-type |\n|---|---|---|---|---|---|---|---|\n${colStats.join("\n")}`
    : `**Analyse CSV réelle** — ${out} (aucune colonne majoritairement numérique à agréger).`;
  return { name, ok: true, exitCode: 0, summary: out, output: out, markdown: md };
}

// ── 4. Résumé extractif réel (scoring de fréquence, sans LLM) ───────────────
const STOP = new Set(("le la les un une des du de d l et ou mais donc or ni car a à au aux en dans par pour sur avec sans sous que qui quoi dont où ce cette ces cet il elle ils elles on nous vous je tu se sa son ses leur leurs lui y ne pas plus moins très tout tous toute toutes comme aussi être est sont était étaient avoir ont avait fait faire peut pourrait the a an of to in and or for on with is are was were be been this that it as at by from not have has had will would can could").split(" "));

export function summarizeText(raw: string): SkillOutcome {
  const name = "text.extractive_summary";
  const text = raw.replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 20);
  const words = text.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  const score = (s: string) => {
    const ws = s.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/g) ?? [];
    return ws.reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length || 1);
  };
  const top = sentences
    .map((s, i) => ({ s, i, sc: score(s) }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, Math.min(5, Math.max(3, Math.ceil(sentences.length * 0.15))))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  const stats = `${words.length} mots, ${sentences.length} phrases, ~${Math.max(1, Math.round(words.length / 200))} min de lecture`;
  return {
    name, ok: true, exitCode: 0,
    summary: `Résumé extractif calculé (${stats})`,
    output: top.join(" "),
    markdown: `**Résumé extractif réel** (scoring de fréquence — ${stats})\n\n${top.map((s) => `> ${s}`).join("\n")}\n\n**Mots-clés dominants** : ${keywords.join(", ") || "—"}`,
  };
}

// ── 5. Revue statique de code réelle ────────────────────────────────────────
export function reviewCode(lang: string, code: string): SkillOutcome {
  const name = "code.static_review";
  const lines = code.split("\n");
  const count = (re: RegExp) => (code.match(re) || []).length;
  const findings: string[] = [];
  const todo = count(/\b(TODO|FIXME|XXX)\b/g);
  if (todo) findings.push(`${todo} marqueur(s) TODO/FIXME`);
  const longLines = lines.filter((l) => l.length > 120).length;
  if (longLines) findings.push(`${longLines} ligne(s) > 120 caractères`);
  if (/\beval\s*\(/.test(code)) findings.push("usage d'`eval()` (risque d'injection)");
  if (/\bvar\s+/.test(code)) findings.push("`var` détecté (préférer `let`/`const`)");
  if (count(/[^=!]==[^=]/g)) findings.push("égalité faible `==` (préférer `===`)");
  const fns = count(/\bfunction\b|=>/g);
  const branches = count(/\b(if|for|while|case|catch)\b/g);
  const out = `${lines.length} lignes, ~${fns} fonction(s), ${branches} branche(s) de contrôle ; ${findings.length} point(s) d'attention.`;
  return {
    name, ok: true, exitCode: 0,
    summary: out, output: out,
    markdown: `**Revue statique réelle (${lang})** — ${out}${findings.length ? `\n${findings.map((f) => `- ⚠ ${f}`).join("\n")}` : "\n- ✓ aucun anti-pattern courant détecté"}`,
  };
}

// ── 6. Validation JSON réelle ───────────────────────────────────────────────
export function validateJson(raw: string): SkillOutcome {
  const name = "data.json_validate";
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    const kind = Array.isArray(parsed) ? `tableau de ${parsed.length} élément(s)` : typeof parsed === "object" && parsed ? `objet à ${Object.keys(parsed).length} clé(s)` : typeof parsed;
    return {
      name, ok: true, exitCode: 0,
      summary: `JSON valide (${kind})`, output: cap(pretty, 1500),
      markdown: `**Validation JSON réelle** : ✓ valide — ${kind}.\n\`\`\`json\n${cap(pretty, 1200)}\n\`\`\``,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name, ok: false, exitCode: 1, summary: "JSON invalide", output: msg, markdown: `**Validation JSON réelle** : ✗ invalide — \`${msg}\`` };
  }
}

// ── 7. Lecture web réelle (URLs fournies par l'utilisateur) ─────────────────
export async function fetchPages(urls: string[]): Promise<SkillOutcome> {
  const name = "web.fetch_sources";
  const citations: { url: string; title: string; quote: string }[] = [];
  const notes: string[] = [];
  for (const url of urls.slice(0, 3)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "CORTEXP-local-agent" } });
      clearTimeout(timer);
      const html = (await res.text()).slice(0, 300_000);
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || url;
      const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const quote = body.slice(0, 400) || "(contenu non textuel)";
      citations.push({ url, title, quote });
      notes.push(`- ✓ ${title} — HTTP ${res.status}, ${body.length.toLocaleString("fr-FR")} caractères de texte extraits`);
    } catch {
      notes.push(`- ✗ ${url} — inaccessible depuis cet environnement (délai ou réseau filtré)`);
    }
  }
  const ok = citations.length > 0;
  return {
    name, ok, exitCode: ok ? 0 : 1,
    summary: `${citations.length}/${urls.length} source(s) lue(s)`,
    output: notes.join("\n"),
    markdown: `**Lecture web réelle** (${citations.length}/${urls.length} source(s)) :\n${notes.join("\n")}`,
    citations,
  };
}

function fail(name: string, summary: string, detail: string): SkillOutcome {
  return { name, ok: false, exitCode: 1, summary, output: detail, markdown: `**${name}** : ${summary}` };
}

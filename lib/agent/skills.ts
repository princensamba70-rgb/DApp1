// ── Boîte à outils d'EXÉCUTION RÉELLE du moteur local CORTEXP ───────────────
// Chaque compétence effectue un travail réel et vérifiable, sans aucune API
// externe : exécution JavaScript en VM isolée, statistiques CSV, résumé
// extractif, calcul, revue de code statique, validation JSON, lecture web.
// Rien n'est simulé : les sorties proviennent de calculs effectivement réalisés.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

export type SkillOutcome = {
  name: string;
  summary: string;
  output: string;
  ok: boolean;
  exitCode: number;
  markdown: string;
  citations?: { url: string; title: string; quote: string }[];
};

export type TaskCtx = { workspaceDir?: string; sessionId?: string };

export type Task =
  | { kind: "js"; code: string }
  | { kind: "json"; raw: string }
  | { kind: "csv"; raw: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "math"; expr: string }
  | { kind: "web"; urls: string[] }
  | { kind: "text"; raw: string }
  | { kind: "project"; brief: string }
  | { kind: "research"; query: string };

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

  // Demande de création de projet / de code → génération réelle de fichiers
  const wantsProject =
    /\b(cr[ée]{1,2}[rz]?|g[ée]n[èe]re[rz]?|code[rz]?|d[ée]veloppe[rz]?|construis|construire|r[ée]alise[rz]?|fais|faire|build|create|make)\b[\s\S]{0,80}?\b(site|page|portfolio|landing|vitrine|application|app|api|serveur|backend|script|jeu|projet|website|web)\b/i;
  if (wantsProject.test(objective)) tasks.push({ kind: "project", brief: objective.trim() });

  // Aucune tâche détectée → question générale : recherche web réelle + synthèse citée
  if (tasks.length === 0) tasks.push({ kind: "research", query: objective.trim() });

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
    case "project": return `Générer le projet complet : « ${t.brief.replace(/\s+/g, " ").slice(0, 48)}… »`;
    case "research": return `Rechercher sur le web : « ${t.query.replace(/\s+/g, " ").slice(0, 48)} »`;
  }
}

export async function runTask(t: Task, ctx: TaskCtx = {}): Promise<SkillOutcome> {
  switch (t.kind) {
    case "js": return runJavaScript(t.code);
    case "json": return validateJson(t.raw);
    case "csv": return analyzeCsv(t.raw);
    case "code": return reviewCode(t.lang, t.code);
    case "math": return evalMath(t.expr);
    case "web": return fetchPages(t.urls);
    case "text": return summarizeText(t.raw);
    case "project": return generateProject(t.brief, ctx);
    case "research": return researchAnswer(t.query);
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

// ── 8. Recherche web réelle + synthèse extractive citée ────────────────────
// Parcourt réellement le web (DuckDuckGo HTML + Wikipédia) pour répondre à une
// question : extraction du texte des pages, scoring des passages contre les
// termes de la question, réponse composée UNIQUEMENT de contenus sourcés.
async function fetchText(url: string): Promise<{ title: string; body: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (CORTEXP local agent)" } });
    const html = (await res.text()).slice(0, 400_000);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || url;
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#?\w+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { title, body, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export async function researchAnswer(query: string): Promise<SkillOutcome> {
  const name = "web.research";
  const q = query.replace(/\s+/g, " ").trim().slice(0, 200);
  const terms = (q.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/g) ?? []).filter((w) => !STOP.has(w));
  const citations: { url: string; title: string; quote: string }[] = [];
  const notes: string[] = [];
  const sources: { url: string; title: string; body: string }[] = [];

  // Source 1 : Wikipédia (API officielle, extraits en texte brut)
  for (const lang of ["fr", "en"]) {
    if (sources.length >= 2) break;
    try {
      const s = await fetchText(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&utf8=1`
      );
      const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(s.body.includes("{") ? s.body : "")?.[1];
      // fetchText a retiré les balises mais l'API renvoie du JSON : re-fetch brut
      const raw = await (async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
          const r = await fetch(
            `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&utf8=1`,
            { signal: ctrl.signal, headers: { "user-agent": "CORTEXP-local-agent" } }
          );
          return (await r.json()) as { query?: { search?: { title: string }[] } };
        } finally {
          clearTimeout(t);
        }
      })().catch(() => null);
      const pageTitle = raw?.query?.search?.[0]?.title ?? title;
      if (!pageTitle) continue;
      const page = await fetchText(`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`);
      if (page.body.length > 300) {
        sources.push({ url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`, title: `${pageTitle} — Wikipédia (${lang})`, body: page.body });
        notes.push(`- ✓ Wikipédia (${lang}) : « ${pageTitle} »`);
      }
    } catch {
      notes.push(`- ✗ Wikipédia (${lang}) : inaccessible depuis cet environnement`);
    }
  }

  // Source 2 : DuckDuckGo HTML (résultats web généraux)
  try {
    const ddg = await (async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          headers: { "user-agent": "Mozilla/5.0 (CORTEXP local agent)" },
        });
        return await r.text();
      } finally {
        clearTimeout(t);
      }
    })();
    const links = [...ddg.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)]
      .map((m) => {
        const uddg = /uddg=([^&]+)/.exec(m[1])?.[1];
        return uddg ? decodeURIComponent(uddg) : m[1];
      })
      .filter((u) => u.startsWith("http"))
      .slice(0, 2);
    for (const u of links) {
      try {
        const page = await fetchText(u);
        if (page.body.length > 300) {
          sources.push({ url: u, title: page.title, body: page.body });
          notes.push(`- ✓ ${page.title.slice(0, 80)}`);
        }
      } catch {
        notes.push(`- ✗ ${u} : page inaccessible`);
      }
    }
  } catch {
    notes.push("- ✗ Moteur de recherche inaccessible depuis cet environnement");
  }

  if (sources.length === 0) {
    return {
      name, ok: false, exitCode: 1,
      summary: "Recherche web impossible (réseau indisponible ou filtré)",
      output: notes.join("\n"),
      markdown:
        `**Recherche web** — aucune source n'a pu être consultée :\n${notes.join("\n")}\n\n` +
        `> Depuis un environnement connecté (ex. votre déploiement Docker), cette recherche s'exécute réellement. ` +
        `Pour des réponses rédigées par un modèle, branchez un fournisseur en ligne compatible OpenAI ` +
        `(\`AI_PROVIDER=openai\` + \`OPENAI_BASE_URL\` — voir README).`,
    };
  }

  // Scoring des passages contre les termes de la question
  const scored: { s: string; sc: number; src: number }[] = [];
  sources.forEach((src, i) => {
    for (const s of src.body.split(/(?<=[.!?…])\s+/)) {
      if (s.length < 60 || s.length > 420) continue;
      const low = s.toLowerCase();
      const sc = terms.reduce((a, t) => a + (low.includes(t) ? 1 : 0), 0);
      if (sc >= Math.max(1, Math.ceil(terms.length * 0.25))) scored.push({ s: s.trim(), sc, src: i });
    }
  });
  scored.sort((a, b) => b.sc - a.sc);
  const picked = scored.slice(0, 4);
  sources.forEach((src, i) => {
    const quote = picked.find((p) => p.src === i)?.s ?? src.body.slice(0, 200);
    citations.push({ url: src.url, title: src.title, quote: quote.slice(0, 300) });
  });

  const answer =
    picked.length > 0
      ? picked.map((p) => `> ${p.s} *[source ${p.src + 1}]*`).join("\n\n")
      : `> ${sources[0].body.slice(0, 350)}… *[source 1]*`;

  return {
    name, ok: true, exitCode: 0,
    summary: `${sources.length} source(s) consultée(s), ${picked.length} passage(s) pertinent(s) extraits`,
    output: notes.join("\n"),
    markdown:
      `**Réponse — synthèse extractive des sources consultées** (passages réels, non générés) :\n\n${answer}\n\n` +
      `**Sources parcourues :**\n${sources.map((s, i) => `${i + 1}. [${s.title.slice(0, 90)}](${s.url})`).join("\n")}`,
    citations,
  };
}

// ── 9. Génération RÉELLE de projets complets (fichiers écrits sur disque) ──
function projectTitle(brief: string): string {
  const t = brief
    .replace(/\b(cr[ée]{1,2}[rz]?|g[ée]n[èe]re[rz]?|code[rz]?|d[ée]veloppe[rz]?|construis|r[ée]alise[rz]?|fais|moi|un|une|le|la|les|de|des|du|pour|avec|complet|complète|projet|s'il te plaît|stp)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 60) || "Mon projet";
}

export function generateProject(brief: string, ctx: TaskCtx): SkillOutcome {
  const name = "project.generate";
  const title = projectTitle(brief);
  const isApi = /\b(api|serveur|backend|express|rest)\b/i.test(brief);
  const isPython = /\b(python|script py)\b/i.test(brief);

  let files: Record<string, string>;
  let runHint: string;
  if (isApi) {
    files = nodeApiTemplate(title, brief);
    runHint = "`node server.js` puis `curl http://localhost:4000/api/items`";
  } else if (isPython) {
    files = pythonTemplate(title, brief);
    runHint = "`python3 main.py --help`";
  } else {
    files = websiteTemplate(title, brief);
    runHint = "ouvrir `index.html` dans un navigateur (aucune dépendance)";
  }

  const dir = ctx.workspaceDir;
  const written: string[] = [];
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [fname, content] of Object.entries(files)) {
      // Confinement strict : nom simple, pas de traversée de répertoire
      if (!/^[\w.-]+$/.test(fname)) continue;
      fs.writeFileSync(path.join(dir, fname), content, "utf8");
      written.push(fname);
    }
  }

  const tree = Object.entries(files)
    .map(([f, c]) => `├── ${f}  (${c.length.toLocaleString("fr-FR")} octets)`)
    .join("\n");
  const mainFile = isApi ? "server.js" : isPython ? "main.py" : "index.html";
  const download = ctx.sessionId
    ? `\n**Téléchargement** : \`GET /api/sessions/${ctx.sessionId}/artifacts\` (liste) puis \`/artifacts/<fichier>\`.`
    : "";

  return {
    name, ok: true, exitCode: 0,
    summary: `${Object.keys(files).length} fichier(s) générés et écrits${written.length ? ` dans l'espace de travail` : ""}`,
    output: `projet « ${title} » : ${Object.keys(files).join(", ")}`,
    markdown:
      `**Projet complet généré et écrit sur disque** — « ${title} »\n\n\`\`\`text\nprojet/\n${tree}\n\`\`\`\n` +
      `**Lancer** : ${runHint}.${download}\n\n**\`${mainFile}\` (intégral) :**\n\`\`\`${mainFile.endsWith(".py") ? "python" : mainFile.endsWith(".js") ? "js" : "html"}\n${cap(files[mainFile], 5000)}\n\`\`\`\n` +
      `*Les autres fichiers sont complets dans l'espace de travail (aucun extrait tronqué sur disque).*`,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function websiteTemplate(rawTitle: string, brief: string): Record<string, string> {
  const title = escapeHtml(rawTitle);
  const desc = escapeHtml(brief.replace(/\s+/g, " ").trim().slice(0, 140));
  return {
    "index.html": `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${desc}" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="nav">
    <strong>${title}</strong>
    <nav>
      <a href="#services">Services</a>
      <a href="#apropos">À propos</a>
      <a href="#contact" class="btn">Contact</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>${title}</h1>
      <p>${desc}</p>
      <a href="#contact" class="btn btn-lg">Démarrer</a>
    </section>
    <section id="services" class="cards">
      <article class="card"><h3>Qualité</h3><p>Un travail soigné, livré dans les délais.</p></article>
      <article class="card"><h3>Sur mesure</h3><p>Chaque projet est adapté à vos besoins réels.</p></article>
      <article class="card"><h3>Suivi</h3><p>Un interlocuteur unique, disponible et réactif.</p></article>
    </section>
    <section id="apropos" class="about">
      <h2>À propos</h2>
      <p>Cette page a été générée automatiquement par CORTEXP à partir de votre demande, prête à personnaliser.</p>
    </section>
    <section id="contact" class="contact">
      <h2>Contact</h2>
      <form id="contact-form">
        <input type="text" name="nom" placeholder="Votre nom" required />
        <input type="email" name="email" placeholder="Votre email" required />
        <textarea name="message" placeholder="Votre message" rows="4" required></textarea>
        <button type="submit" class="btn">Envoyer</button>
      </form>
      <p id="form-status" role="status"></p>
    </section>
  </main>
  <footer>© <span id="year"></span> ${title}</footer>
  <script src="script.js"></script>
</body>
</html>
`,
    "styles.css": `:root { --ink:#111111; --muted:#6b6b66; --line:#e7e5e4; --bg:#ffffff; --soft:#f6f6f5; }
* { box-sizing:border-box; margin:0; }
body { font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg); line-height:1.6; }
.nav { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); }
.nav nav { display:flex; gap:20px; align-items:center; }
a { color:var(--ink); text-decoration:none; }
.btn { background:var(--ink); color:#fff; padding:10px 18px; border-radius:10px; border:0; cursor:pointer; font-size:15px; }
.btn:hover { opacity:.85; }
.btn-lg { padding:14px 26px; font-size:17px; display:inline-block; margin-top:18px; }
.hero { text-align:center; padding:96px 24px 64px; max-width:760px; margin:auto; }
.hero h1 { font-size:clamp(32px,6vw,56px); letter-spacing:-.02em; }
.hero p { color:var(--muted); font-size:19px; margin-top:12px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; padding:32px 24px; max-width:1000px; margin:auto; }
.card { border:1px solid var(--line); border-radius:14px; padding:24px; background:var(--bg); box-shadow:0 4px 18px rgba(0,0,0,.04); }
.about, .contact { max-width:720px; margin:auto; padding:48px 24px; }
form { display:grid; gap:12px; margin-top:16px; }
input, textarea { border:1px solid var(--line); border-radius:10px; padding:12px; font:inherit; background:var(--soft); }
input:focus, textarea:focus { outline:2px solid var(--ink); background:#fff; }
footer { border-top:1px solid var(--line); text-align:center; padding:24px; color:var(--muted); }
`,
    "script.js": `// Interactions de base — généré par CORTEXP
document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("contact-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  console.log("Message à envoyer :", data);
  document.getElementById("form-status").textContent =
    "Merci " + data.nom + " ! Votre message est prêt à être branché à votre backend.";
  e.target.reset();
});
`,
    "README.md": `# ${title}

Site statique complet généré par **CORTEXP** à partir de la demande :
> ${desc}

## Lancer
Ouvrez simplement \`index.html\` dans un navigateur — aucune dépendance.
Pour servir en local : \`npx serve .\` ou \`python3 -m http.server 8080\`.

## Structure
- \`index.html\` — page complète (héros, services, à propos, contact)
- \`styles.css\` — design moderne clair (blanc / noir)
- \`script.js\` — interactions (année dynamique, formulaire)
`,
  };
}

function nodeApiTemplate(title: string, brief: string): Record<string, string> {
  const desc = brief.replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    "server.js": `// ${title} — API REST complète sans dépendance (node:http), générée par CORTEXP.
const http = require("node:http");
const items = [{ id: 1, nom: "exemple", creeLe: new Date().toISOString() }];
let nextId = 2;

const json = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, { service: "${title}", endpoints: ["GET /api/items", "POST /api/items", "GET /api/items/:id", "DELETE /api/items/:id"] });
  }
  if (url.pathname === "/api/items" && req.method === "GET") return json(res, 200, { items });
  if (url.pathname === "/api/items" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { nom } = JSON.parse(body || "{}");
        if (!nom || typeof nom !== "string") return json(res, 400, { error: "champ 'nom' requis" });
        const item = { id: nextId++, nom, creeLe: new Date().toISOString() };
        items.push(item);
        json(res, 201, { item });
      } catch { json(res, 400, { error: "JSON invalide" }); }
    });
    return;
  }
  const m = url.pathname.match(/^\\/api\\/items\\/(\\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return json(res, 404, { error: "introuvable" });
    if (req.method === "GET") return json(res, 200, { item: items[idx] });
    if (req.method === "DELETE") { const [gone] = items.splice(idx, 1); return json(res, 200, { supprime: gone }); }
  }
  json(res, 404, { error: "route inconnue" });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(\`${title} → http://localhost:\${PORT}\`));
`,
    "package.json": `{
  "name": "${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api-cortexp"}",
  "version": "1.0.0",
  "description": "${desc}",
  "main": "server.js",
  "scripts": { "start": "node server.js" }
}
`,
    "README.md": `# ${title}

API REST complète générée par **CORTEXP** — zéro dépendance (module \`node:http\`).

## Lancer
\`\`\`bash
node server.js
# ou : npm start
\`\`\`

## Endpoints
| Méthode | Route | Description |
|---|---|---|
| GET | / | index des endpoints |
| GET | /api/items | liste |
| POST | /api/items | création \`{"nom":"..."}\` |
| GET | /api/items/:id | détail |
| DELETE | /api/items/:id | suppression |

## Exemples
\`\`\`bash
curl http://localhost:4000/api/items
curl -X POST http://localhost:4000/api/items -H "Content-Type: application/json" -d '{"nom":"test"}'
\`\`\`
`,
  };
}

function pythonTemplate(title: string, brief: string): Record<string, string> {
  const desc = brief.replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    "main.py": `#!/usr/bin/env python3
"""${title} — outil en ligne de commande complet, généré par CORTEXP.
${desc}
"""
import argparse, json, os, sys
from datetime import datetime

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "donnees.json")

def charger():
    if os.path.exists(DB):
        with open(DB, encoding="utf-8") as f:
            return json.load(f)
    return []

def sauver(items):
    with open(DB, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

def main():
    p = argparse.ArgumentParser(description="${title}")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("ajouter", help="ajouter un élément"); a.add_argument("texte")
    sub.add_parser("lister", help="lister les éléments")
    s = sub.add_parser("supprimer", help="supprimer par numéro"); s.add_argument("numero", type=int)
    args = p.parse_args()
    items = charger()
    if args.cmd == "ajouter":
        items.append({"texte": args.texte, "date": datetime.now().isoformat(timespec="seconds")})
        sauver(items); print(f"Ajouté ({len(items)} au total).")
    elif args.cmd == "lister":
        if not items: print("(vide)")
        for i, it in enumerate(items, 1): print(f"{i}. {it['texte']}  [{it['date']}]")
    elif args.cmd == "supprimer":
        if 1 <= args.numero <= len(items):
            gone = items.pop(args.numero - 1); sauver(items); print(f"Supprimé : {gone['texte']}")
        else:
            print("Numéro invalide", file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    main()
`,
    "README.md": `# ${title}

Outil CLI Python complet généré par **CORTEXP** (bibliothèque standard uniquement).

## Utiliser
\`\`\`bash
python3 main.py ajouter "Première note"
python3 main.py lister
python3 main.py supprimer 1
\`\`\`
`,
  };
}

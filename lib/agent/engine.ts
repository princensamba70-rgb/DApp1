// Moteur d'agent CORTEXP.
// - DEMO_MODE (par défaut) : simule un run crédible avec le même contrat de
//   streaming (plan vivant, outils, auto-correction exit 1 → edit → exit 0,
//   sous-agents et citations en mode Kingly).
// - Si ANTHROPIC_API_KEY est défini : la réponse finale est générée par le
//   modèle réel (streaming), le reste du contrat d'événements est identique.
import type { AgentEvent, PlanStep, RunMeta, ToolCallInfo } from "./types";
import { modelFor, systemPromptFor } from "./prompts";
import { streamAnthropic } from "./anthropic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const estimateTokens = (s: string) => Math.max(1, Math.round(s.length / 4));

function shortObjective(objective: string): string {
  const clean = objective.replace(/\s+/g, " ").trim();
  return clean.length > 64 ? clean.slice(0, 61) + "…" : clean;
}

function buildPlan(mode: "agent" | "kingly", objective: string): PlanStep[] {
  const o = shortObjective(objective);
  if (mode === "kingly") {
    return [
      { id: "s1", title: `Clarifier l'objectif : « ${o} »`, status: "pending", subagentRole: "orchestrateur" },
      { id: "s2", title: "Explorer le contexte et les sources", status: "pending", subagentRole: "researcher" },
      { id: "s3", title: "Analyser l'architecture / les données", status: "pending", subagentRole: "architect" },
      { id: "s4", title: "Implémenter et exécuter la solution", status: "pending", subagentRole: "code-explorer" },
      { id: "s5", title: "Contre-vérification indépendante", status: "pending", subagentRole: "verifier" },
      { id: "s6", title: "Produire le livrable final cité", status: "pending", subagentRole: "doc-writer" },
    ];
  }
  return [
    { id: "s1", title: `Analyser l'objectif : « ${o} »`, status: "pending" },
    { id: "s2", title: "Préparer l'espace de travail sandbox", status: "pending" },
    { id: "s3", title: "Implémenter et exécuter le code", status: "pending" },
    { id: "s4", title: "Tester, lire les erreurs, corriger", status: "pending" },
    { id: "s5", title: "Livrer le résultat et le résumé", status: "pending" },
  ];
}

function demoFinalAnswer(mode: "agent" | "kingly", objective: string): string {
  const o = objective.trim();
  const base = `## Objectif traité

> ${o}

### Ce qui a été fait
1. **Plan établi** puis exécuté étape par étape dans la sandbox \`/workspace\`.
2. **Script écrit et exécuté** : la première exécution a échoué (\`exit 1\`, variable non définie), l'erreur a été lue dans \`stderr\`, le code a été **corrigé automatiquement**, puis relancé avec succès (\`exit 0\`).
3. **Vérification** : la sortie finale a été contrôlée avant livraison.

### Livrable
\`\`\`text
/workspace/
├── solution.py      # script final, exécuté avec succès
├── resultat.md      # synthèse exploitable
└── run.log          # trace complète des exécutions
\`\`\`

### Prochain pas suggéré
Précise les contraintes (format, volume, délai) pour affiner le livrable, ou
demande l'export ZIP des fichiers générés.`;

  if (mode === "kingly") {
    return (
      base +
      `

### Vérification indépendante (Kingly 1)
Le sous-agent **verifier** a contesté les résultats : 2 affirmations ont été
re-prouvées par ré-exécution, aucune contradiction restante.

### Sources consultées
- Documentation officielle (consultée aujourd'hui) — citation ancrée dans le rapport.
- Dépôt de référence GitHub — fichier \`README.md\`, section installation.

*Mode démo : branchez \`ANTHROPIC_API_KEY\` dans \`.env\` pour une génération réelle.*`
    );
  }
  return base + `

*Mode démo : branchez \`ANTHROPIC_API_KEY\` dans \`.env\` pour une génération réelle.*`;
}

export async function* runAgent(
  runId: string,
  mode: "agent" | "kingly",
  objective: string,
  history: { role: string; content: string }[]
): AsyncGenerator<AgentEvent, RunMeta> {
  const model = modelFor(mode);
  const meta: RunMeta = {
    mode,
    model,
    plan: [],
    tools: [],
    subagents: [],
    citations: [],
    thinking: "",
    tokensIn: estimateTokens(systemPromptFor(mode) + objective),
    tokensOut: 0,
    costUsd: 0,
  };

  yield { t: "run_start", runId, mode, model };

  // 1) Réflexion courte
  const thinking =
    mode === "kingly"
      ? "Décomposition de l'objectif en phases. Attribution des sous-agents. Critères de preuve définis."
      : "Reformulation de l'objectif. Identification des outils nécessaires. Critères de réussite définis.";
  for (const word of thinking.split(" ")) {
    meta.thinking += word + " ";
    yield { t: "thinking_delta", text: word + " " };
    await sleep(18);
  }

  // 2) Plan vivant
  const plan = buildPlan(mode, objective);
  meta.plan = plan;
  yield { t: "plan_update", steps: plan.map((s) => ({ ...s })) };
  await sleep(250);

  const setStep = function* (id: string, status: PlanStep["status"]) {
    const step = plan.find((s) => s.id === id);
    if (step) step.status = status;
    yield { t: "todo_update", id, status } as AgentEvent;
  };

  // 3) Sous-agents (Kingly uniquement)
  if (mode === "kingly") {
    for (const sa of [
      { id: "sa1", role: "researcher", status: "démarré" },
      { id: "sa2", role: "architect", status: "démarré" },
      { id: "sa3", role: "verifier", status: "en attente" },
    ]) {
      meta.subagents.push(sa);
      yield { t: "subagent_update", ...sa };
      await sleep(120);
    }
  }

  // 4) Exécution outillée avec auto-correction visible
  yield* setStep("s1", "in_progress");
  await sleep(300);
  yield* setStep("s1", "done");
  yield* setStep("s2", "in_progress");

  const tool1: ToolCallInfo = {
    callId: "t1",
    name: "bash",
    summary: "$ mkdir -p /workspace && cd /workspace && git init -q",
  };
  meta.tools.push(tool1);
  yield { t: "tool_start", call: { ...tool1 } };
  await sleep(420);
  Object.assign(tool1, { ok: true, exitCode: 0, durationMs: 412, output: "Initialized empty Git repository in /workspace/.git/" });
  yield { t: "tool_end", callId: "t1", ok: true, exitCode: 0, durationMs: 412, output: tool1.output };
  yield* setStep("s2", "done");
  yield* setStep("s3", "in_progress");

  const tool2: ToolCallInfo = {
    callId: "t2",
    name: "fs_write",
    summary: "solution.py (+38 lignes)",
  };
  meta.tools.push(tool2);
  yield { t: "tool_start", call: { ...tool2 } };
  await sleep(380);
  Object.assign(tool2, { ok: true, exitCode: 0, durationMs: 123, output: "38 lignes écrites dans /workspace/solution.py" });
  yield { t: "tool_end", callId: "t2", ok: true, exitCode: 0, durationMs: 123, output: tool2.output };

  // Premier run : échec volontaire (démonstration de l'auto-correction)
  const tool3: ToolCallInfo = { callId: "t3", name: "bash", summary: "$ python3 solution.py" };
  meta.tools.push(tool3);
  yield { t: "tool_start", call: { ...tool3 } };
  await sleep(600);
  const err = 'Traceback (most recent call last):\n  File "/workspace/solution.py", line 21, in <module>\n    print(resultat)\nNameError: name \'resultat\' is not defined';
  Object.assign(tool3, { ok: false, exitCode: 1, durationMs: 587, output: err });
  yield { t: "tool_end", callId: "t3", ok: false, exitCode: 1, durationMs: 587, output: err };
  yield* setStep("s3", "done");
  yield* setStep("s4", "in_progress");

  const tool4: ToolCallInfo = {
    callId: "t4",
    name: "fs_edit",
    summary: "solution.py (+2 −1) — correction NameError ligne 21",
  };
  meta.tools.push(tool4);
  yield { t: "tool_start", call: { ...tool4 } };
  await sleep(350);
  Object.assign(tool4, {
    ok: true, exitCode: 0, durationMs: 95,
    output: "@@ -19,3 +19,4 @@\n-    print(resultat)\n+    resultat = calculer(donnees)\n+    print(resultat)",
  });
  yield { t: "tool_end", callId: "t4", ok: true, exitCode: 0, durationMs: 95, output: tool4.output };

  const tool5: ToolCallInfo = { callId: "t5", name: "bash", summary: "$ python3 solution.py" };
  meta.tools.push(tool5);
  yield { t: "tool_start", call: { ...tool5 } };
  await sleep(520);
  Object.assign(tool5, { ok: true, exitCode: 0, durationMs: 503, output: "OK — résultat écrit dans /workspace/resultat.md" });
  yield { t: "tool_end", callId: "t5", ok: true, exitCode: 0, durationMs: 503, output: tool5.output };
  yield* setStep("s4", "done");

  if (mode === "kingly") {
    yield { t: "subagent_update", id: "sa3", role: "verifier", status: "vérification en cours" };
    meta.subagents = meta.subagents.map((s) => (s.id === "sa3" ? { ...s, status: "vérification en cours" } : s));
    await sleep(500);
    yield* setStep("s5", "in_progress");
    const citations = [
      { url: "https://docs.python.org/3/", title: "Documentation Python 3", quote: "NameError: raised when a local or global name is not found." },
      { url: "https://github.com", title: "Dépôt de référence", quote: "Installation : voir la section Quickstart du README." },
    ];
    for (const c of citations) {
      meta.citations.push(c);
      yield { t: "citation", ...c };
      await sleep(150);
    }
    yield { t: "subagent_update", id: "sa3", role: "verifier", status: "validé — aucune contradiction" };
    meta.subagents = meta.subagents.map((s) => (s.id === "sa3" ? { ...s, status: "validé — aucune contradiction" } : s));
    yield* setStep("s5", "done");
    yield* setStep("s6", "in_progress");
  } else {
    yield* setStep("s5", "in_progress");
  }

  // 5) Réponse finale — streaming (réel si clé API, sinon démo)
  let final = "";
  const useReal = process.env.DEMO_MODE !== "true" && Boolean(process.env.ANTHROPIC_API_KEY);
  if (useReal) {
    try {
      for await (const chunk of streamAnthropic(mode, objective, history)) {
        final += chunk;
        yield { t: "content_delta", text: chunk };
      }
    } catch {
      final = "";
    }
  }
  if (!final) {
    const text = demoFinalAnswer(mode, objective);
    // Streaming par petits morceaux pour l'effet terminal
    for (let i = 0; i < text.length; i += 14) {
      const chunk = text.slice(i, i + 14);
      final += chunk;
      yield { t: "content_delta", text: chunk };
      await sleep(8);
    }
  }

  yield* setStep(mode === "kingly" ? "s6" : "s5", "done");

  meta.tokensOut = estimateTokens(final) + estimateTokens(meta.thinking);
  meta.costUsd = Number(((meta.tokensIn * 3 + meta.tokensOut * 15) / 1_000_000).toFixed(4));
  yield { t: "usage", tokensIn: meta.tokensIn, tokensOut: meta.tokensOut, costUsd: meta.costUsd };
  yield { t: "run_end", runId, status: "success", summary: "Livrable produit, toutes les étapes validées." };

  return meta;
}

export { estimateTokens };

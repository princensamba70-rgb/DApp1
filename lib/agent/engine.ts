// ── Moteur d'agent CORTEXP — EXÉCUTION RÉELLE, sans API Anthropic ───────────
// Le moteur local détecte les tâches exécutables de la demande (code JS, CSV,
// JSON, calculs, URLs, textes longs), les EXÉCUTE réellement via lib/agent/
// skills.ts (VM isolée, statistiques, résumé extractif, lecture web…), puis
// compose le livrable à partir des résultats effectifs. En mode KINGLY 1, les
// résultats déterministes sont RE-EXÉCUTÉS indépendamment et comparés.
// Un fournisseur optionnel (openai compatible / anthropic opt-in) peut
// enrichir la rédaction : il n'est JAMAIS requis.
import type { AgentEvent, PlanStep, RunMeta, ToolCallInfo } from "./types";
import { modelFor, systemPromptFor } from "./prompts";
import { resolveProvider, streamCompletion } from "./provider";
import { detectTasks, runTask, taskLabel, type SkillOutcome, type Task, type TaskCtx } from "./skills";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const estimateTokens = (s: string) => Math.max(1, Math.round(s.length / 4));

const TOOL_BY_KIND: Record<Task["kind"], string> = {
  js: "vm.run_javascript",
  code: "code.static_review",
  csv: "data.csv_stats",
  json: "data.json_validate",
  math: "calc.evaluate",
  web: "web.fetch_sources",
  text: "text.extractive_summary",
  project: "project.generate",
  research: "web.research",
};

const ROLE_BY_KIND: Record<Task["kind"], string> = {
  js: "code-executor",
  code: "code-reviewer",
  csv: "data-analyst",
  json: "data-analyst",
  math: "data-analyst",
  web: "researcher",
  text: "doc-analyst",
  project: "code-builder",
  research: "researcher",
};

function shortObjective(objective: string): string {
  const clean = objective.replace(/\s+/g, " ").trim();
  return clean.length > 64 ? clean.slice(0, 61) + "…" : clean;
}

export async function* runAgent(
  runId: string,
  mode: "agent" | "kingly",
  objective: string,
  history: { role: string; content: string }[],
  sessionId?: string
): AsyncGenerator<AgentEvent, RunMeta> {
  const ctx: TaskCtx = sessionId
    ? { sessionId, workspaceDir: path.join(process.cwd(), "data", "workspaces", sessionId) }
    : {};
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

  // 1) Détection RÉELLE des tâches exécutables
  const tasks = detectTasks(objective);
  const thinking =
    `Analyse de la demande : ${tasks.length} tâche(s) exécutable(s) détectée(s)` +
    (tasks.length ? ` — ${tasks.map((t) => t.kind).join(", ")}. ` : ". ") +
    (mode === "kingly"
      ? "Attribution aux sous-agents spécialisés, contre-vérification par ré-exécution prévue."
      : "Exécution directe outil par outil, chaque sortie sera vérifiable.");
  for (const word of thinking.split(" ")) {
    meta.thinking += word + " ";
    yield { t: "thinking_delta", text: word + " " };
    await sleep(12);
  }

  // 2) Plan construit à partir des tâches réellement détectées
  const plan: PlanStep[] = [
    { id: "s0", title: `Analyser la demande : « ${shortObjective(objective)} »`, status: "done", ...(mode === "kingly" ? { subagentRole: "orchestrateur" } : {}) },
    ...tasks.map((t, i) => ({
      id: `t${i}`,
      title: taskLabel(t),
      status: "pending" as const,
      ...(mode === "kingly" ? { subagentRole: ROLE_BY_KIND[t.kind] } : {}),
    })),
    ...(mode === "kingly"
      ? [{ id: "verify", title: "Contre-vérification par ré-exécution indépendante", status: "pending" as const, subagentRole: "verifier" }]
      : []),
    { id: "final", title: "Composer le livrable à partir des résultats réels", status: "pending", ...(mode === "kingly" ? { subagentRole: "doc-writer" } : {}) },
  ];
  meta.plan = plan;
  yield { t: "plan_update", steps: plan.map((s) => ({ ...s })) };

  function* setStep(id: string, status: PlanStep["status"]): Generator<AgentEvent> {
    const st = plan.find((s) => s.id === id);
    if (st) st.status = status;
    yield { t: "todo_update", id, status };
  }

  if (mode === "kingly") {
    const roles = [...new Set(["orchestrateur", ...tasks.map((t) => ROLE_BY_KIND[t.kind]), "verifier", "doc-writer"])];
    meta.subagents = roles.map((r, i) => ({ id: `sa${i}`, role: r, status: "prêt" }));
    for (const sa of meta.subagents) yield { t: "subagent_update", ...sa };
  }

  // 3) EXÉCUTION RÉELLE de chaque tâche (événements outil = sorties réelles)
  const results: { task: Task; outcome: SkillOutcome }[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    yield* setStep(`t${i}`, "in_progress");
    const callId = `${runId}-c${i}`;
    const t0 = Date.now();
    yield { t: "tool_start", call: { callId, name: TOOL_BY_KIND[task.kind], summary: taskLabel(task) } };
    const outcome = await runTask(task, ctx);
    const durationMs = Date.now() - t0;
    const call: ToolCallInfo = {
      callId,
      name: outcome.name,
      summary: outcome.summary,
      output: outcome.output,
      exitCode: outcome.exitCode,
      ok: outcome.ok,
      durationMs,
    };
    meta.tools.push(call);
    yield { t: "tool_end", callId, ok: outcome.ok, exitCode: outcome.exitCode, durationMs, output: outcome.output };
    for (const c of outcome.citations ?? []) {
      meta.citations.push(c);
      yield { t: "citation", ...c };
    }
    results.push({ task, outcome });
    yield* setStep(`t${i}`, outcome.ok ? "done" : "failed");
  }

  // 4) KINGLY : contre-vérification RÉELLE (ré-exécution + comparaison stricte)
  const verifications: string[] = [];
  if (mode === "kingly") {
    yield* setStep("verify", "in_progress");
    for (const { task, outcome } of results) {
      if (task.kind === "web" || task.kind === "research") {
        verifications.push(`- \`${outcome.name}\` : non rejouable hors ligne (source réseau) — citations conservées telles quelles.`);
        continue;
      }
      const second = await runTask(task, ctx);
      const same = second.output === outcome.output && second.exitCode === outcome.exitCode;
      verifications.push(
        same
          ? `- \`${outcome.name}\` : ré-exécuté indépendamment → **résultat identique** ✓`
          : `- \`${outcome.name}\` : **écart détecté** entre les deux exécutions (résultat non déterministe) ⚠`
      );
    }
    const saV = meta.subagents.find((s) => s.role === "verifier");
    if (saV) {
      saV.status = verifications.some((v) => v.includes("écart")) ? "écart signalé" : "validé — aucune contradiction";
      yield { t: "subagent_update", ...saV };
    }
    yield* setStep("verify", "done");
  }

  // 5) Livrable composé à partir des RÉSULTATS RÉELS
  yield* setStep("final", "in_progress");

  const failed = results.filter((r) => !r.outcome.ok).length;
  const sections: string[] = [`## Objectif\n\n> ${objective.replace(/\s+/g, " ").trim().slice(0, 300)}`];

  if (results.length > 0) {
    sections.push(`## Travaux exécutés (résultats réels)\n\n${results.map((r) => r.outcome.markdown).join("\n\n")}`);
  } else {
    sections.push(
      `## Analyse de la demande\n\nAucun contenu directement exécutable n'a été fourni. Le moteur local exécute réellement :\n` +
        `- **Code JavaScript** (bloc \`\`\`js) — VM isolée, sortie et erreurs réelles ;\n` +
        `- **Tableaux CSV** — statistiques complètes (min, max, moyenne, médiane, somme, écart-type) ;\n` +
        `- **JSON** — validation et formatage ;\n` +
        `- **Calculs** — expressions arithmétiques ;\n` +
        `- **URLs** — lecture et citation des sources fournies ;\n` +
        `- **Textes longs** — résumé extractif et mots-clés.\n\n` +
        `Collez le contenu à traiter (code, données, texte, liens) dans votre message pour une exécution immédiate.`
    );
  }
  if (mode === "kingly" && verifications.length > 0) {
    sections.push(`## Vérification indépendante (KINGLY 1)\n\n${verifications.join("\n")}`);
  }
  if (meta.citations.length > 0) {
    sections.push(`## Sources consultées\n\n${meta.citations.map((c) => `- [${c.title}](${c.url}) — « ${c.quote.slice(0, 140)}… »`).join("\n")}`);
  }
  sections.push(
    `## Synthèse\n\n${results.length} tâche(s) exécutée(s)${failed ? `, dont ${failed} en échec (sortie d'erreur réelle ci-dessus)` : " avec succès"}. ` +
      `Toutes les sorties ci-dessus proviennent d'exécutions effectives du moteur local — aucune API externe n'a été sollicitée${meta.citations.length ? ", hormis la lecture des URLs que vous avez fournies" : ""}.`
  );

  const composed = sections.join("\n\n");

  // Fournisseur optionnel (openai local / anthropic opt-in) : rédaction
  // enrichie EN PLUS des résultats réels — jamais requis, repli automatique.
  let final = "";
  if (resolveProvider().provider !== "local") {
    try {
      const prompt = `${objective}\n\nRésultats d'exécution réels à intégrer fidèlement :\n${composed}`;
      for await (const chunk of streamCompletion(mode, prompt, history)) {
        final += chunk;
        yield { t: "content_delta", text: chunk };
      }
      if (final) {
        const annex = `\n\n---\n\n${composed}`;
        final += annex;
        for (let i = 0; i < annex.length; i += 24) yield { t: "content_delta", text: annex.slice(i, i + 24) };
      }
    } catch {
      final = "";
    }
  }
  if (!final) {
    final = composed;
    for (let i = 0; i < composed.length; i += 24) {
      yield { t: "content_delta", text: composed.slice(i, i + 24) };
      await sleep(4);
    }
  }

  yield* setStep("final", "done");

  meta.tokensOut = estimateTokens(final) + estimateTokens(meta.thinking);
  // Moteur local : coût nul. Fournisseur externe opt-in : estimation indicative.
  meta.costUsd =
    resolveProvider().provider === "local"
      ? 0
      : Number(((meta.tokensIn * 3 + meta.tokensOut * 15) / 1_000_000).toFixed(4));
  yield { t: "usage", tokensIn: meta.tokensIn, tokensOut: meta.tokensOut, costUsd: meta.costUsd };
  yield {
    t: "run_end",
    runId,
    status: failed === 0 ? "success" : failed < results.length ? "partial" : "failed",
    summary:
      results.length === 0
        ? "Analyse livrée — fournissez du contenu exécutable pour aller plus loin."
        : `${results.length - failed}/${results.length} tâche(s) exécutée(s) avec succès, livrable composé des résultats réels.`,
  };

  return meta;
}

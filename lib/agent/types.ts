// Contrat de streaming SSE — événements typés du moteur d'agent.
export type PlanStep = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  subagentRole?: string;
};

export type ToolCallInfo = {
  callId: string;
  name: string;
  summary: string;
  output?: string;
  exitCode?: number;
  ok?: boolean;
  durationMs?: number;
};

export type SubAgentInfo = { id: string; role: string; status: string };
export type CitationInfo = { url: string; title: string; quote: string };

export type AgentEvent =
  | { t: "run_start"; runId: string; mode: "agent" | "kingly"; model: string }
  | { t: "thinking_delta"; text: string }
  | { t: "content_delta"; text: string }
  | { t: "plan_update"; steps: PlanStep[] }
  | { t: "todo_update"; id: string; status: PlanStep["status"] }
  | { t: "tool_start"; call: ToolCallInfo }
  | { t: "tool_end"; callId: string; ok: boolean; exitCode?: number; durationMs: number; output?: string }
  | { t: "subagent_update"; id: string; role: string; status: string }
  | { t: "citation"; url: string; title: string; quote: string }
  | { t: "usage"; tokensIn: number; tokensOut: number; costUsd: number }
  | { t: "error"; message: string; kind: string; recoverable: boolean }
  | { t: "run_end"; runId: string; status: "success" | "partial" | "failed"; summary: string };

// Métadonnées persistées avec chaque message assistant (rejouables à l'ouverture)
export type RunMeta = {
  mode: "agent" | "kingly";
  model: string;
  plan: PlanStep[];
  tools: ToolCallInfo[];
  subagents: SubAgentInfo[];
  citations: CitationInfo[];
  thinking: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

// UI message model consumed by the deck/* components (kept identical to the
// design-frozen spec; `mock-data.ts` is gone, these types live here now).
export type Role = "user" | "claude" | "system";

export type ToolCall = {
  name: string;
  input: string;
  /** One-line preview shown in the collapsed header. */
  output?: string;
  /** Full (capped) tool output shown when the block is expanded. */
  outputFull?: string;
};

export type Attachment = {
  name: string;
  kind: "file" | "image" | "dir";
};

export type Message = {
  id: string;
  role: Role;
  content: string;
  code?: { lang: string; value: string };
  tool?: ToolCall;
  attachments?: Attachment[];
  streaming?: boolean;
  time: string;
};

export type Model = {
  id: string;
  name: string;
  context: string;
  blurb: string;
};

// Reasoning-effort levels accepted by the Claude Agent SDK (effort option).
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type Effort = {
  id: EffortLevel;
  name: string;
  blurb: string;
};

// Server-reported defaults for new chats (GET /api/config). Mirrors the values the
// session manager applies when a session sets none (DECK_MODEL / DECK_CHAT_EFFORT).
export interface ServerConfig {
  defaultModel: string;
  defaultEffort: EffortLevel;
}

// ---- Backend wire types (mirror server/src/store.ts + routes.ts) ----
export interface Project {
  name: string;
  path: string;
}

export interface Session {
  id: string;
  project_path: string;
  title: string | null;
  sdk_session_id: string | null;
  status: "idle" | "active" | "errored";
  kind?: string;
  origin?: string;
  prompt?: string | null;
  model?: string | null;
  effort?: string | null;
  /** JSON array string of disabled built-in tool names (disallowedTools). */
  disabled_tools?: string | null;
  source_kind?: string | null;
  source_id?: string | null;
  ended_at?: number | null;
  result?: string | null;
  created_at: number;
}

// Raw WebSocket frame: { type, payload, at } — payload is the SDK message or
// one of our injected envelopes (user_prompt / ready / busy / cancelled / error).
export interface DeckMessage {
  type: string;
  payload: any;
  at?: number;
  /** Monotonic server sequence number (absent on control frames like `ready`). */
  seq?: number;
}

export interface ImageAttachment {
  media_type: string;
  data: string;
  name: string;
}

// ---- Automation wire types (mirror server/src/store.ts TicketRow / CronRow) ----
export interface Ticket {
  id: string;
  title: string;
  body: string | null;
  status: string; // free-text; 'open' | 'running' | 'review' | 'done' | 'failed'
  project_path: string;
  session_id: string | null;
  pr_url: string | null;
  created_at: number;
}

export interface Cron {
  id: string;
  schedule: string;
  project_path: string;
  prompt: string;
  enabled: number; // 0 | 1
  last_run_at: number | null;
  last_session_id: string | null;
  created_at: number;
}

// GET /api/tasks/:id returns the task Session plus its full event stream.
export interface TaskDetail extends Session {
  events: DeckMessage[];
}

export interface GoalReport {
  summary: string;
  goal_met: boolean;
  files_changed: string[];
  commands_run: { cmd: string; exit_code: number; output_tail: string }[];
  incomplete: string[];
  notes?: string;
  error?: string;
}

export interface GoalVerdict {
  achieved: boolean;
  reasons: string;
  unmet_criteria: string[];
  tests_summary: string;
  dimensions?: { name: string; passed: boolean; notes: string }[];
}

export interface Goal {
  id: string;
  project_path: string;
  title: string;
  expected_output: string;
  acceptance: string | null;
  status: "queued" | "building" | "verifying" | "achieved" | "review" | "failed" | "cancelled";
  branch: string | null;
  worktree_path: string | null;
  session_id: string | null;
  report: string | null;
  verdict: string | null;
  max_iterations: number;
  iteration: number;
  qa_dimensions: string;
  created_at: number;
}

export interface GoalDetail extends Goal {
  events: DeckMessage[];
}

export interface Knowledge {
  id: number;
  scope: string; // 'global' | <project_path>
  kind: "binding" | "convention" | "rule" | "preference" | "infra";
  key: string | null;
  fact: string;
  source_session: string | null;
  created_at: number;
  updated_at: number;
}

/** A sensitive tool call on an untrusted autonomous run, blocked awaiting a human
 *  approve/deny (the HITL gate). */
export interface Approval {
  id: string;
  sessionId: string;
  tool: string;
  summary: string;
  createdAt: number;
}

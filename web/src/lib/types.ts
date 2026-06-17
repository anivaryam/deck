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

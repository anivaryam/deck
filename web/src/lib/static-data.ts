import type { Effort, Model } from "./types";

// Real model ids the backend / Claude Agent SDK accepts. Default (opus) first to
// match the server default (config.ts: DECK_MODEL=claude-opus-4-8). Visual
// treatment is unchanged from the spec.
export const MODELS: Model[] = [
  { id: "claude-opus-4-8", name: "claude-opus-4.8", context: "1M", blurb: "deep reasoning · default" },
  { id: "claude-sonnet-4-6", name: "claude-sonnet-4.6", context: "200K", blurb: "balanced" },
  { id: "claude-haiku-4-5-20251001", name: "claude-haiku-4.5", context: "200K", blurb: "fast · cheap" },
];

// Reasoning effort levels forwarded to the SDK at session creation. "high" is the
// SDK default; "xhigh"/"max" only apply on models that support them (newer Opus,
// Sonnet 4.6) — the SDK clamps unsupported levels rather than erroring.
export const EFFORTS: Effort[] = [
  { id: "low", name: "low", blurb: "minimal thinking · fastest" },
  { id: "medium", name: "medium", blurb: "moderate thinking" },
  { id: "high", name: "high", blurb: "deep reasoning · default" },
  { id: "xhigh", name: "xhigh", blurb: "deeper than high" },
  { id: "max", name: "max", blurb: "maximum effort · select models" },
];

// Composer slash-menu. Inserts text into the prompt; the CLI/SDK interprets it.
export const SLASH_COMMANDS = [
  { cmd: "/help", desc: "show available commands" },
  { cmd: "/clear", desc: "clear conversation" },
  { cmd: "/model", desc: "switch model" },
  { cmd: "/mcp", desc: "list MCP servers" },
  { cmd: "/cost", desc: "show token usage" },
  { cmd: "/compact", desc: "summarize history" },
  { cmd: "/review", desc: "review staged diff" },
  { cmd: "/exit", desc: "end session" },
];

// Display-only chrome for the settings panel (no backend surface to edit these).
export const MCP_SERVERS = [
  { name: "filesystem", status: "connected", tools: 8 },
  { name: "github", status: "connected", tools: 14 },
  { name: "postgres", status: "idle", tools: 6 },
  { name: "linear", status: "disconnected", tools: 0 },
];

export const TOOLS = [
  { name: "Read", enabled: true },
  { name: "Write", enabled: true },
  { name: "Edit", enabled: true },
  { name: "Bash", enabled: true },
  { name: "Grep", enabled: true },
  { name: "WebFetch", enabled: false },
];

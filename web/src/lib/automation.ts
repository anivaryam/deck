import type { Project, Session, Ticket } from "./types";

export type AutomationStatus = "open" | "running" | "review" | "done" | "failed" | "merged" | "closed";

const KNOWN: AutomationStatus[] = ["open", "running", "review", "done", "failed", "merged", "closed"];

export function normalizeTicketStatus(s: string | null | undefined): AutomationStatus {
  const v = (s ?? "").toLowerCase();
  return (KNOWN as string[]).includes(v) ? (v as AutomationStatus) : "open";
}

/** Map a task Session's lifecycle status onto an automation status. */
export function taskStatus(s: Pick<Session, "status">): AutomationStatus {
  if (s.status === "active") return "running";
  if (s.status === "errored") return "failed";
  return "done";
}

/** Map a goal's status onto the shared automation status vocabulary for chips/dots. */
export function goalStatus(s: string): AutomationStatus {
  switch (s) {
    case "building": return "running";
    case "review": return "review";
    case "failed": return "failed";
    case "cancelled": return "closed";
    default: return "open"; // queued
  }
}

/** Status dot: shape + green intensity; destructive (red) only for failure. */
export function statusDotClass(s: AutomationStatus): string {
  switch (s) {
    case "open":
      return "border border-muted-foreground bg-transparent";
    case "running":
      return "bg-primary shadow-[0_0_8px_var(--color-primary)] animate-pulse";
    case "review":
      return "border border-primary bg-transparent";
    case "done":
      return "bg-primary/60";
    case "failed":
      return "bg-destructive";
    case "merged":
      return "bg-primary";
    case "closed":
      return "bg-muted-foreground/40";
  }
}

/** Status chip text/bg. Same palette discipline. */
export function statusChipClass(s: AutomationStatus): string {
  switch (s) {
    case "open":
      return "bg-muted text-muted-foreground";
    case "running":
      return "bg-primary/15 text-primary";
    case "review":
      return "border border-primary/40 text-primary";
    case "done":
      return "border border-border text-muted-foreground";
    case "failed":
      return "bg-destructive/15 text-destructive";
    case "merged":
      return "bg-primary/15 text-primary";
    case "closed":
      return "bg-muted text-muted-foreground";
  }
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function relativeTime(at: number | null | undefined, now: number = Date.now()): string {
  if (at == null) return "—";
  const d = now - at;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  return `${Math.floor(d / DAY)}d ago`;
}

export function projectNameForPath(projects: Project[], path: string): string | null {
  return projects.find((p) => p.path === path)?.name ?? null;
}

export function byProjectPath<T extends { project_path: string }>(rows: T[], path: string): T[] {
  return rows.filter((r) => r.project_path === path);
}

export const TICKET_TABS = ["all", "open", "running", "review", "done", "failed", "merged", "closed"] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

export function filterTicketsByTab(rows: Ticket[], tab: TicketTab): Ticket[] {
  if (tab === "all") return rows;
  return rows.filter((t) => normalizeTicketStatus(t.status) === tab);
}

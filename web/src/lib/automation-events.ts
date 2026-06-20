export type TaskFrame = {
  id: string;
  source_kind: string | null;
  source_id: string | null;
  status: "active" | "idle" | "errored";
  result: string | null;
};

export type TaskToast = { intent: "success" | "error"; message: string };

/** Query keys to invalidate on every task lifecycle frame. Goal and goal_verify
 *  runs emit these frames too, so goals must refresh live like the other
 *  automation entities (tasks/tickets/cron/runs) instead of relying solely on the
 *  goals-list poll — which only runs while a goal is mid-build and so misses
 *  transitions made elsewhere (other tabs, the autonomous loop) once idle. */
export const TASK_FRAME_QUERY_KEYS = ["tasks", "tickets", "cron", "runs", "goals"] as const;

/** Map a lifecycle frame to a toast intent, or null when no toast should fire.
 *  Only finished cron/ticket runs that succeeded or errored produce a toast. */
export function toastForTask(f: TaskFrame): TaskToast | null {
  if (f.status === "active") return null;
  if (f.source_kind !== "cron" && f.source_kind !== "ticket") return null;
  if (f.result === "success") return { intent: "success", message: `${f.source_kind} run finished` };
  if (f.result === "error" || f.result === "queue_full") return { intent: "error", message: `${f.source_kind} run failed` };
  return null; // cancelled, or unknown
}

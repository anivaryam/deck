import { Link } from "@tanstack/react-router";
import { useRuns } from "@/hooks/use-automation-data";
import { StatusDot } from "./status-chip";
import { relativeTime, taskStatus } from "@/lib/automation";
import type { Session } from "@/lib/types";

function runStatus(s: Session) {
  if (s.result === "error" || s.result === "queue_full") return "failed" as const;
  if (s.result === "cancelled") return "open" as const;
  if (s.result === "success") return "done" as const;
  return taskStatus(s); // still running / legacy
}

function duration(s: Session): string {
  if (!s.ended_at) return "";
  const ms = s.ended_at - s.created_at;
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`;
}

export function RunHistory({
  sourceKind,
  sourceId,
  projectPath,
}: {
  sourceKind: "cron" | "ticket" | "goal" | "goal_verify";
  sourceId: string;
  projectPath: string;
}) {
  const { data, isLoading, isError, error, refetch } = useRuns(sourceKind, sourceId);
  const runs = data ?? [];
  if (isLoading) {
    return <p className="px-2 py-3 text-[11px] text-muted-foreground">Loading runs…</p>;
  }
  if (isError) {
    return (
      <p className="px-2 py-3 text-[11px] text-destructive">
        Couldn’t load runs ({error instanceof Error ? error.message : "error"}).{" "}
        <button onClick={() => refetch()} className="underline hover:text-foreground">
          Retry
        </button>
      </p>
    );
  }
  if (!runs.length) {
    return <p className="px-2 py-3 text-[11px] text-muted-foreground">No runs yet.</p>;
  }
  return (
    <ul className="space-y-0.5 py-1">
      {runs.map((r) => (
        <li key={r.id}>
          <Link
            to="/tasks"
            search={{ project: projectPath, task: r.id }}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <StatusDot status={runStatus(r)} />
            <span className="flex-1 truncate">{r.result ?? "running"}</span>
            <span className="opacity-70">{duration(r)}</span>
            <span className="opacity-50">{relativeTime(r.created_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "./status-chip";
import { relativeTime, taskStatus } from "@/lib/automation";
import type { Session } from "@/lib/types";

export function TasksList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Session[];
  selectedId: string | null;
  onSelect: (t: Session) => void;
}) {
  if (tasks.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No tasks.</p>;
  }
  return (
    <div className="p-2">
      {tasks.map((t) => {
        const status = taskStatus(t);
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border border-transparent px-3.5 py-3 text-left",
              selectedId === t.id ? "border-border bg-card" : "hover:border-border hover:bg-card",
            )}
          >
            <StatusDot status={status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {t.title ?? t.prompt ?? t.id}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {relativeTime(t.created_at)}
              </span>
            </span>
            {t.origin && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                {t.origin}
              </span>
            )}
            <StatusChip status={status} />
          </button>
        );
      })}
    </div>
  );
}

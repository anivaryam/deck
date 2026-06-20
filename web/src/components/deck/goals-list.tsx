import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "./status-chip";
import { goalStatus, relativeTime } from "@/lib/automation";
import type { Goal } from "@/lib/types";

export function GoalsList({
  goals, selectedId, onSelect,
}: { goals: Goal[]; selectedId: string | null; onSelect: (g: Goal) => void }) {
  if (goals.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No goals.</p>;
  }
  return (
    <div className="p-2">
      {goals.map((g) => {
        const status = goalStatus(g.status);
        return (
          <button
            key={g.id}
            onClick={() => onSelect(g)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border border-transparent px-3.5 py-3 text-left",
              selectedId === g.id ? "border-border bg-card" : "hover:border-border hover:bg-card",
            )}
          >
            <StatusDot status={status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{g.title}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{relativeTime(g.created_at)}</span>
            </span>
            <StatusChip status={status} />
          </button>
        );
      })}
    </div>
  );
}

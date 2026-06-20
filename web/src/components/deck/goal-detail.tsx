import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./status-chip";
import { TaskOutput } from "./task-output";
import { GoalReportView } from "./goal-report";
import { useCancelGoal, useDeleteGoal, useRunGoal } from "@/hooks/use-automation-data";
import { goalStatus, relativeTime } from "@/lib/automation";
import { ApiError } from "@/lib/api";
import type { Goal, GoalReport } from "@/lib/types";

export function GoalDetail({ goal, onDeleted }: { goal: Goal; onDeleted?: () => void }) {
  const run = useRunGoal();
  const cancel = useCancelGoal();
  const del = useDeleteGoal();
  const status = goalStatus(goal.status);
  const building = goal.status === "building";
  let report: GoalReport | null = null;
  try { report = goal.report ? JSON.parse(goal.report) : null; } catch { report = null; }

  const onDelete = () => {
    if (!window.confirm(`Delete goal "${goal.title}"? This cannot be undone.`)) return;
    del.mutate(goal.id, {
      onSuccess: () => onDeleted?.(),
      onError: (e) => toast.error(e instanceof ApiError && e.status === 409 ? "Cancel the goal before deleting it" : "Couldn't delete"),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="mb-2"><StatusChip status={status} /></div>
        <h2 className="text-sm font-bold leading-snug">{goal.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-xs text-muted-foreground">
        <p className="mb-3 whitespace-pre-wrap leading-relaxed">{goal.expected_output}</p>
        {goal.branch && <div className="mb-3 font-mono text-[11px]">branch: <span className="text-foreground">{goal.branch}</span></div>}
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">created</div>
        <div className="mb-3 text-[11px]">{relativeTime(goal.created_at)}</div>
        {report && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Report</div>
            <GoalReportView report={report} />
          </div>
        )}
        {goal.session_id && (
          <div className="mt-2 h-64 overflow-hidden rounded-md border border-border">
            <TaskOutput taskId={goal.session_id} />
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-4">
        {building ? (
          <Button className="flex-1" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(goal.id)}>
            Cancel
          </Button>
        ) : (
          <Button className="flex-1" disabled={run.isPending} onClick={() => run.mutate(goal.id)}>
            {run.isPending ? "Starting…" : goal.status === "queued" ? "▶ Run" : "▶ Run again"}
          </Button>
        )}
        <Button
          variant="ghost" size="icon" aria-label="Delete goal" title="Delete goal"
          disabled={del.isPending || building} onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

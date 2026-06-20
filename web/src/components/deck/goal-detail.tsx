import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./status-chip";
import { TaskOutput } from "./task-output";
import { GoalReportView } from "./goal-report";
import { RunHistory } from "./run-history";
import { useCancelGoal, useDeleteGoal, useRunGoal } from "@/hooks/use-automation-data";
import { goalStatus, relativeTime } from "@/lib/automation";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GoalVerdictView } from "./goal-verdict";
import type { Goal, GoalReport, GoalVerdict } from "@/lib/types";

export function GoalDetail({ goal, onDeleted }: { goal: Goal; onDeleted?: () => void }) {
  const run = useRunGoal();
  const cancel = useCancelGoal();
  const del = useDeleteGoal();
  const status = goalStatus(goal.status);
  const building = goal.status === "building" || goal.status === "verifying";
  let report: GoalReport | null = null;
  try { report = goal.report ? JSON.parse(goal.report) : null; } catch { report = null; }
  let verdict: GoalVerdict | null = null;
  try { verdict = goal.verdict ? JSON.parse(goal.verdict) : null; } catch { verdict = null; }
  let qaDims: string[] = [];
  try { const p = JSON.parse(goal.qa_dimensions); if (Array.isArray(p)) qaDims = p.filter((d) => typeof d === "string"); } catch { qaDims = []; }

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
      <div className={cn("overflow-y-auto p-4 text-xs text-muted-foreground", goal.session_id ? "max-h-[45%] shrink-0" : "flex-1")}>
        <p className="mb-3 whitespace-pre-wrap leading-relaxed">{goal.expected_output}</p>
        {goal.branch && <div className="mb-3 font-mono text-[11px]">branch: <span className="text-foreground">{goal.branch}</span></div>}
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">attempt</div>
        <div className="mb-3 text-[11px]">{Math.min(goal.iteration + 1, goal.max_iterations)} / {goal.max_iterations}</div>
        {qaDims.length > 0 && (
          <>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">QA dimensions</div>
            <div className="mb-3 flex flex-wrap gap-1 text-[11px] capitalize text-foreground">{qaDims.map((d) => <span key={d} className="rounded border border-border px-1.5">{d}</span>)}</div>
          </>
        )}
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">created</div>
        <div className="mb-3 text-[11px]">{relativeTime(goal.created_at)}</div>
        {verdict && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Verdict</div>
            <GoalVerdictView verdict={verdict} />
          </div>
        )}
        {report && (
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Report</div>
            <GoalReportView report={report} />
          </div>
        )}
        <div className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">build attempts</div>
        <RunHistory sourceKind="goal" sourceId={goal.id} projectPath={goal.project_path} />
        <div className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">verifications</div>
        <RunHistory sourceKind="goal_verify" sourceId={goal.id} projectPath={goal.project_path} />
      </div>
      {goal.session_id && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          <div className="shrink-0 px-4 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            live output · {goal.status}
          </div>
          <TaskOutput taskId={goal.session_id} />
        </div>
      )}
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

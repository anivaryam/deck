import { toast } from "sonner";
import { RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCancelTask, useCreateTask, useDeleteTask } from "@/hooks/use-automation-data";
import { taskStatus } from "@/lib/automation";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/types";

/** Action row for a selected task. Mutually exclusive by state:
 *  active → Cancel; finished → Re-run + Delete. */
export function TaskActions({
  task,
  projectName,
  onDeleted,
}: {
  task: Session;
  projectName: string | null;
  onDeleted: () => void;
}) {
  const cancel = useCancelTask();
  const rerun = useCreateTask();
  const del = useDeleteTask();
  const active = taskStatus(task) === "running";

  const onCancel = () =>
    cancel.mutate(task.id, {
      onSuccess: (r) => toast.success(r.aborted ? "Task cancelled" : "Task already finished"),
      onError: (e) => toast.error(`Couldn't cancel: ${e instanceof Error ? e.message : "error"}`),
    });

  const onRerun = () => {
    if (!projectName) return;
    rerun.mutate(
      { project: projectName, prompt: task.prompt ?? "", model: task.model ?? undefined, effort: task.effort ?? undefined },
      {
        onSuccess: () => toast.success("Re-run started"),
        onError: (e) => toast.error(`Couldn't re-run: ${e instanceof Error ? e.message : "error"}`),
      },
    );
  };

  const onDelete = () => {
    if (!window.confirm("Delete this task and its output? This cannot be undone.")) return;
    del.mutate(task.id, {
      onSuccess: () => onDeleted(),
      onError: (e) =>
        toast.error(e instanceof ApiError && e.status === 409 ? "Cancel the task before deleting it" : `Couldn't delete: ${e instanceof Error ? e.message : "error"}`),
    });
  };

  return (
    <div className="flex gap-2 border-b border-border p-3">
      {active ? (
        <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={onCancel} className="text-muted-foreground hover:text-destructive">
          <XCircle className="mr-1 size-4" /> Cancel
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" disabled={rerun.isPending || !task.prompt || !projectName} onClick={onRerun}>
            <RotateCcw className="mr-1 size-4" /> Re-run
          </Button>
          <Button variant="ghost" size="sm" disabled={del.isPending} onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="mr-1 size-4" /> Delete
          </Button>
        </>
      )}
    </div>
  );
}

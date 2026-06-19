import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useDeleteCron, useRunCron, useUpdateCron } from "@/hooks/use-automation-data";
import { relativeTime } from "@/lib/automation";
import { cn } from "@/lib/utils";
import type { Cron } from "@/lib/types";
import { RunHistory } from "./run-history";
import { CronForm } from "./cron-form";

export function CronList({ crons }: { crons: Cron[] }) {
  const toggle = useUpdateCron();
  const del = useDeleteCron();
  const fire = useRunCron();
  const onFire = (c: Cron) =>
    fire.mutate(c.id, {
      onSuccess: () => toast.success("Run started"),
      onError: (e) => toast.error(`Couldn't start run: ${e instanceof Error ? e.message : "error"}`),
    });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  if (crons.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No cron schedules.</p>;
  }

  const onToggle = (id: string, enabled: boolean) =>
    toggle.mutate({ id, patch: { enabled } }, { onError: (e) => toast.error(`Couldn't update schedule: ${e instanceof Error ? e.message : "error"}`) });

  const onDelete = (c: Cron) => {
    if (!window.confirm(`Delete this cron schedule?\n\n${c.schedule} — ${c.prompt}`)) return;
    del.mutate(c.id, {
      onSuccess: () => toast.success("Schedule deleted"),
      onError: (e) => toast.error(`Couldn't delete schedule: ${e instanceof Error ? e.message : "error"}`),
    });
  };
  return (
    <div className="p-2">
      {crons.map((c) =>
        editingId === c.id ? (
          <div key={c.id} className="rounded-md border border-border bg-card">
            <CronForm
              initial={{ id: c.id, schedule: c.schedule, prompt: c.prompt }}
              onDone={() => setEditingId(null)}
            />
          </div>
        ) : (
          <div key={c.id}>
            <div className="flex items-center gap-3 rounded-md border border-transparent px-3.5 py-3 hover:border-border hover:bg-card">
              <Switch
                checked={c.enabled === 1}
                onCheckedChange={(v) => onToggle(c.id, v)}
                disabled={toggle.isPending}
                aria-label={c.enabled === 1 ? "Disable schedule" : "Enable schedule"}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm text-foreground">{c.schedule}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{c.prompt}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                last: {relativeTime(c.last_run_at)}
              </span>
              <button
                onClick={() => setOpen((s) => ({ ...s, [c.id]: !s[c.id] }))}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Show runs"
              >
                <ChevronRight className={cn("size-4 transition-transform", open[c.id] && "rotate-90")} />
              </button>
              <Button variant="ghost" size="sm" onClick={() => onFire(c)} disabled={fire.isPending} aria-label="Run now">
                ▶ Run
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingId(c.id)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(c)} disabled={del.isPending}>
                Delete
              </Button>
            </div>
            {open[c.id] && (
              <div className="ml-9 border-l border-border pl-2">
                <RunHistory sourceKind="cron" sourceId={c.id} projectPath={c.project_path} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

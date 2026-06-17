import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useDeleteCron, useUpdateCron } from "@/hooks/use-automation-data";
import { relativeTime } from "@/lib/automation";
import { cn } from "@/lib/utils";
import type { Cron } from "@/lib/types";
import { RunHistory } from "./run-history";

export function CronList({ crons }: { crons: Cron[] }) {
  const toggle = useUpdateCron();
  const del = useDeleteCron();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (crons.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No cron schedules.</p>;
  }
  return (
    <div className="p-2">
      {crons.map((c) => (
        <div key={c.id}>
          <div className="flex items-center gap-3 rounded-md border border-transparent px-3.5 py-3 hover:border-border hover:bg-card">
            <Switch
              checked={c.enabled === 1}
              onCheckedChange={(v) => toggle.mutate({ id: c.id, enabled: v })}
              disabled={toggle.isPending}
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
            <Button variant="ghost" size="sm" onClick={() => del.mutate(c.id)}>
              Delete
            </Button>
          </div>
          {open[c.id] && (
            <div className="ml-9 border-l border-border pl-2">
              <RunHistory sourceKind="cron" sourceId={c.id} projectPath={c.project_path} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

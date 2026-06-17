import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useDeleteCron, useUpdateCron } from "@/hooks/use-automation-data";
import { relativeTime } from "@/lib/automation";
import type { Cron } from "@/lib/types";

export function CronList({ crons }: { crons: Cron[] }) {
  const toggle = useUpdateCron();
  const del = useDeleteCron();

  if (crons.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No cron schedules.</p>;
  }
  return (
    <div className="p-2">
      {crons.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md border border-transparent px-3.5 py-3 hover:border-border hover:bg-card">
          <Switch
            checked={c.enabled === 1}
            onCheckedChange={(v) => toggle.mutate({ id: c.id, enabled: v })}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm text-foreground">{c.schedule}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{c.prompt}</span>
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            last: {relativeTime(c.last_run_at)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => del.mutate(c.id)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}

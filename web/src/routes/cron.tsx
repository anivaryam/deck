import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { CronList } from "@/components/deck/cron-list";
import { CronForm } from "@/components/deck/cron-form";
import { useCron } from "@/hooks/use-automation-data";
import { useProjects } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/cron")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: CronRoute,
});

function CronRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const { data } = useCron();
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      title={`Cron · ${name ?? project}`}
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>
          + New cron
        </Button>
      }
      list={
        creating && name ? (
          <CronForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <CronList crons={rows} />
        )
      }
    />
  );
}

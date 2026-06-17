import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { CronList } from "@/components/deck/cron-list";
import { CronForm } from "@/components/deck/cron-form";
import { useCron } from "@/hooks/use-automation-data";
import { useProjects, useSessions } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/cron")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: CronRoute,
});

function CronRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const sessions = useSessions();
  const { data } = useCron();
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);

  const projectThreadId = useMemo(() => {
    const chats = (sessions.data ?? []).filter(
      (s) => s.project_path === project && (s.kind ?? "chat") === "chat",
    );
    if (!chats.length) return undefined;
    return chats.reduce((a, b) => (b.created_at > a.created_at ? b : a)).id;
  }, [sessions.data, project]);

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      projectName={name ?? project}
      projectThreadId={projectThreadId}
      section="Cron"
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

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { TasksList } from "@/components/deck/tasks-list";
import { TaskOutput } from "@/components/deck/task-output";
import { useTasks } from "@/hooks/use-automation-data";
import { useProjects } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/tasks")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: TasksRoute,
});

function TasksRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const { data } = useTasks();
  const [selId, setSelId] = useState<string | null>(null);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      title={`Tasks · ${name ?? project}`}
      list={<TasksList tasks={rows} selectedId={selId} onSelect={(t) => setSelId(t.id)} />}
      detail={selId ? <TaskOutput taskId={selId} /> : undefined}
    />
  );
}

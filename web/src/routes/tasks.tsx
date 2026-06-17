import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { TasksList } from "@/components/deck/tasks-list";
import { TaskOutput } from "@/components/deck/task-output";
import { useTasks } from "@/hooks/use-automation-data";
import { useProjects, useSessions } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/tasks")({
  validateSearch: (s: Record<string, unknown>): { project: string; task?: string } => ({ project: String(s.project ?? ""), task: s.task ? String(s.task) : undefined }),
  component: TasksRoute,
});

function TasksRoute() {
  const { project, task } = Route.useSearch();
  const projects = useProjects();
  const sessions = useSessions();
  const { data } = useTasks();
  const [selId, setSelId] = useState<string | null>(task ?? null);

  useEffect(() => { if (task) setSelId(task); }, [task]);

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
      section="Tasks"
      list={<TasksList tasks={rows} selectedId={selId} onSelect={(t) => setSelId(t.id)} />}
      detail={selId ? <TaskOutput taskId={selId} /> : undefined}
      onCloseDetail={() => setSelId(null)}
    />
  );
}

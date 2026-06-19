import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { TasksList } from "@/components/deck/tasks-list";
import { TaskOutput } from "@/components/deck/task-output";
import { TaskActions } from "@/components/deck/task-actions";
import { TaskForm } from "@/components/deck/task-form";
import { AsyncBoundary, useAuthRedirect } from "@/components/deck/async-boundary";
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
  const tasksQ = useTasks();
  const { data } = tasksQ;
  useAuthRedirect(tasksQ.error, projects.error, sessions.error);
  const [selId, setSelId] = useState<string | null>(task ?? null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { if (task) setSelId(task); }, [task]);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);
  const selected = useMemo(() => (data ?? []).find((t) => t.id === selId) ?? null, [data, selId]);

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
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>
          + New task
        </Button>
      }
      list={
        creating && name ? (
          <TaskForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <AsyncBoundary query={tasksQ} label="tasks">
            <TasksList tasks={rows} selectedId={selId} onSelect={(t) => setSelId(t.id)} />
          </AsyncBoundary>
        )
      }
      detail={
        selected ? (
          <div className="flex h-full flex-col">
            <TaskActions task={selected} projectName={name} onDeleted={() => setSelId(null)} />
            <TaskOutput taskId={selected.id} />
          </div>
        ) : selId ? (
          <TaskOutput taskId={selId} />
        ) : undefined
      }
      onCloseDetail={() => setSelId(null)}
    />
  );
}

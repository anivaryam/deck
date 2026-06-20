import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { GoalsList } from "@/components/deck/goals-list";
import { GoalDetail } from "@/components/deck/goal-detail";
import { GoalForm } from "@/components/deck/goal-form";
import { AsyncBoundary, useAuthRedirect } from "@/components/deck/async-boundary";
import { useGoal, useGoals } from "@/hooks/use-automation-data";
import { useProjects, useSessions } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/goals")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: GoalsRoute,
});

function GoalsRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const sessions = useSessions();
  const goalsQ = useGoals();
  const { data } = goalsQ;
  useAuthRedirect(goalsQ.error, projects.error, sessions.error);
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);
  const selectedLive = useGoal(selId);
  const selected = selectedLive.data ?? rows.find((g) => g.id === selId) ?? null;

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
      section="Goals"
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>+ New goal</Button>
      }
      list={
        creating && name ? (
          <GoalForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <AsyncBoundary query={goalsQ} label="goals">
            <GoalsList goals={rows} selectedId={selId} onSelect={(g) => setSelId(g.id)} />
          </AsyncBoundary>
        )
      }
      detail={selected ? <GoalDetail goal={selected} onDeleted={() => setSelId(null)} /> : undefined}
      onCloseDetail={() => setSelId(null)}
    />
  );
}

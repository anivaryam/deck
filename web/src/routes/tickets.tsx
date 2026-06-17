import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { TicketsList } from "@/components/deck/tickets-list";
import { TicketDetail } from "@/components/deck/ticket-detail";
import { TicketForm } from "@/components/deck/ticket-form";
import { useTickets } from "@/hooks/use-automation-data";
import { useProjects } from "@/hooks/use-deck-data";
import {
  byProjectPath,
  filterTicketsByTab,
  projectNameForPath,
  TICKET_TABS,
  type TicketTab,
} from "@/lib/automation";

export const Route = createFileRoute("/tickets")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: TicketsRoute,
});

function TicketsRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const { data } = useTickets();
  const [tab, setTab] = useState<TicketTab>("all");
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(
    () => filterTicketsByTab(byProjectPath(data ?? [], project), tab),
    [data, project, tab],
  );
  const selected = (data ?? []).find((t) => t.id === selId) ?? null;

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      title={`Tickets · ${name ?? project}`}
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>
          + New ticket
        </Button>
      }
      list={
        creating && name ? (
          <TicketForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <TicketsList
            tickets={rows}
            tabs={TICKET_TABS}
            activeTab={tab}
            onTab={setTab}
            selectedId={selId}
            onSelect={(t) => setSelId(t.id)}
          />
        )
      }
      detail={selected ? <TicketDetail ticket={selected} /> : undefined}
    />
  );
}

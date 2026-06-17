import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./status-chip";
import { useRunTicket } from "@/hooks/use-automation-data";
import { normalizeTicketStatus, relativeTime } from "@/lib/automation";
import type { Ticket } from "@/lib/types";
import { RunHistory } from "./run-history";

export function TicketDetail({ ticket }: { ticket: Ticket }) {
  const run = useRunTicket();
  const status = normalizeTicketStatus(ticket.status);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="mb-2">
          <StatusChip status={status} />
        </div>
        <h2 className="text-sm font-bold leading-snug">{ticket.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-xs text-muted-foreground">
        {ticket.body && <p className="mb-3 whitespace-pre-wrap leading-relaxed">{ticket.body}</p>}
        <Row k="status" v={status} />
        {ticket.pr_url && (
          <Row
            k="PR"
            v={
              <a className="text-primary" href={ticket.pr_url} target="_blank" rel="noreferrer">
                link ↗
              </a>
            }
          />
        )}
        <Row k="created" v={relativeTime(ticket.created_at)} />
        {ticket.session_id && (
          <Link
            to="/tasks"
            search={{ project: ticket.project_path, task: ticket.session_id ?? undefined }}
            className="mt-3 flex items-center gap-2 rounded-md border border-border bg-card p-3 text-[11px] text-primary"
          >
            ▸ linked task · view live output
          </Link>
        )}
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Runs</div>
          <RunHistory sourceKind="ticket" sourceId={ticket.id} projectPath={ticket.project_path} />
        </div>
      </div>
      <div className="flex gap-2 border-t border-border p-4">
        <Button
          className="flex-1"
          disabled={run.isPending || status === "running"}
          onClick={() => run.mutate(ticket.id)}
        >
          {run.isPending ? "Starting…" : "▶ Run"}
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}

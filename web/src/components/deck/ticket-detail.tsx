import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TicketForm } from "./ticket-form";
import { StatusChip } from "./status-chip";
import { useDeleteTicket, useRunTicket, useUpdateTicket } from "@/hooks/use-automation-data";
import { normalizeTicketStatus, relativeTime } from "@/lib/automation";
import type { Ticket } from "@/lib/types";
import { RunHistory } from "./run-history";

export function TicketDetail({ ticket, onDeleted }: { ticket: Ticket; onDeleted?: () => void }) {
  const run = useRunTicket();
  const update = useUpdateTicket();
  const del = useDeleteTicket();
  const [editing, setEditing] = useState(false);
  const status = normalizeTicketStatus(ticket.status);

  const onDelete = () => {
    if (!window.confirm(`Delete ticket "${ticket.title}"? This cannot be undone.`)) return;
    del.mutate(ticket.id, { onSuccess: () => onDeleted?.() });
  };

  if (editing) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-4 text-sm font-bold">Edit ticket</div>
        <TicketForm
          initial={{ id: ticket.id, title: ticket.title, body: ticket.body ?? "" }}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit ticket"
          title="Edit ticket"
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete ticket"
          title="Delete ticket"
          disabled={del.isPending}
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
        {status === "review" && (
          <>
            <Button className="flex-1" variant="ghost" onClick={() => update.mutate({ id: ticket.id, patch: { status: "closed" } })}>Close</Button>
            <Button className="flex-1" onClick={() => update.mutate({ id: ticket.id, patch: { status: "merged" } })}>Mark merged</Button>
          </>
        )}
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

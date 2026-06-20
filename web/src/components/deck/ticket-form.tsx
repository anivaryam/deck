import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateTicket, useUpdateTicket } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function TicketForm({
  projectName,
  onDone,
  initial,
}: {
  projectName?: string;
  onDone: () => void;
  initial?: { id: string; title: string; body: string };
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateTicket();
  const update = useUpdateTicket();
  const editing = !!initial;
  const pending = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: initial!.id, patch: { title, body } });
      } else {
        await create.mutateAsync({ project: projectName!, title, body: body || undefined });
      }
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : `failed to ${editing ? "update" : "create"} ticket`);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Ticket title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Details (markdown)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title || pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}

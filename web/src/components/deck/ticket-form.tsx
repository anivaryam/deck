import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateTicket } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function TicketForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateTicket();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ project: projectName, title, body: body || undefined });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create ticket");
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
        <Button type="submit" disabled={!title || create.isPending}>
          {create.isPending ? "Creating…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateCron, useUpdateCron } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function CronForm({
  projectName,
  onDone,
  initial,
}: {
  projectName?: string;
  onDone: () => void;
  initial?: { id: string; schedule: string; prompt: string };
}) {
  const [schedule, setSchedule] = useState(initial?.schedule ?? "0 3 * * *");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateCron();
  const update = useUpdateCron();
  const editing = !!initial;
  const pending = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (editing) {
        await update.mutateAsync({ id: initial!.id, patch: { schedule, prompt } });
      } else {
        await create.mutateAsync({ schedule, project: projectName!, prompt });
      }
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : `failed to ${editing ? "update" : "create"} cron`);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm"
        placeholder="cron expression e.g. 0 3 * * *"
        value={schedule}
        onChange={(e) => setSchedule(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Prompt to run on schedule"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!schedule || !prompt || pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create cron"}
        </Button>
      </div>
    </form>
  );
}

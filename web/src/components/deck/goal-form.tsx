import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateGoal } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function GoalForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [expected, setExpected] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateGoal();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ project: projectName, title, expected_output: expected, acceptance: acceptance || undefined });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create goal");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Goal title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Expected output — what 'done' looks like"
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
        required
      />
      <textarea
        className="min-h-16 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Acceptance criteria (optional)"
        value={acceptance}
        onChange={(e) => setAcceptance(e.target.value)}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!title || !expected || create.isPending}>
          {create.isPending ? "Creating…" : "Create goal"}
        </Button>
      </div>
    </form>
  );
}

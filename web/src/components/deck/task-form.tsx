import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateTask } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;

export function TaskForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateTask();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({
        project: projectName,
        prompt,
        model: model || undefined,
        effort: effort || undefined,
      });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create task");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <textarea
        autoFocus
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Prompt to run as a one-off task"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
          placeholder="model (optional, e.g. claude-opus-4-8)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <select
          className="rounded-md border border-input bg-input/40 px-3 py-2 text-xs"
          value={effort}
          onChange={(e) => setEffort(e.target.value as (typeof EFFORTS)[number])}
          aria-label="effort"
        >
          {EFFORTS.map((e) => (
            <option key={e || "default"} value={e}>
              {e || "default effort"}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!prompt || create.isPending}>
          {create.isPending ? "Starting…" : "Run task"}
        </Button>
      </div>
    </form>
  );
}

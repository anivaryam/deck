import type { GoalVerdict } from "@/lib/types";

export function GoalVerdictView({ verdict }: { verdict: GoalVerdict }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className={verdict.achieved ? "font-medium text-primary" : "font-medium text-destructive"}>
        {verdict.achieved ? "✓ verified achieved" : "✗ not achieved"}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{verdict.reasons}</p>
      {verdict.unmet_criteria?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Unmet criteria</div>
          <ul className="list-inside list-disc text-[11px] text-foreground">
            {verdict.unmet_criteria.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
      {verdict.tests_summary && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Tests</div>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{verdict.tests_summary}</pre>
        </div>
      )}
    </div>
  );
}

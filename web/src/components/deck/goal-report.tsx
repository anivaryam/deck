import type { GoalReport } from "@/lib/types";

export function GoalReportView({ report }: { report: GoalReport }) {
  if (report.error) {
    return <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{report.error}</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <span className={report.goal_met ? "text-primary" : "text-muted-foreground"}>
          {report.goal_met ? "✓ goal_met (agent claim — unverified)" : "✗ not met (agent claim)"}
        </span>
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{report.summary}</p>
      {report.files_changed?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Files changed</div>
          <ul className="list-inside list-disc font-mono text-[11px] text-foreground">
            {report.files_changed.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}
      {report.commands_run?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Commands</div>
          {report.commands_run.map((c, i) => (
            <div key={i} className="mb-1 rounded border border-border p-2">
              <div className="font-mono text-[11px] text-foreground">
                <span className={c.exit_code === 0 ? "text-primary" : "text-destructive"}>[{c.exit_code}]</span> {c.cmd}
              </div>
              {c.output_tail && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{c.output_tail}</pre>}
            </div>
          ))}
        </div>
      )}
      {report.incomplete?.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Incomplete</div>
          <ul className="list-inside list-disc text-[11px] text-foreground">
            {report.incomplete.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

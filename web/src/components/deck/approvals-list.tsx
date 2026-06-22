import { Link } from "@tanstack/react-router";
import type { Approval } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useResolveApproval } from "@/hooks/use-automation-data";

/** Pending HITL approvals: sensitive tool calls (Bash/Write/Edit/…) from untrusted
 *  autonomous runs, each blocked until a human allows or denies it. */
export function ApprovalsList({ approvals }: { approvals: Approval[] }) {
  const resolve = useResolveApproval();

  if (approvals.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No pending approvals. Sensitive tool calls from automated (ticket / cron / goal) runs appear here for review.
      </p>
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {approvals.map((a) => (
        <li key={a.id} className="rounded-md border border-amber-500/40 bg-card p-3">
          <div className="flex items-center gap-2">
            <span className="rounded border border-amber-500/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-300">
              {a.tool}
            </span>
            <Link
              to="/$threadId"
              params={{ threadId: a.sessionId }}
              className="truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              run {a.sessionId.slice(0, 8)}
            </Link>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {new Date(a.createdAt).toLocaleTimeString()}
            </span>
          </div>
          {a.summary && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-background px-2 py-1.5 text-xs text-foreground">
              {a.summary}
            </pre>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: a.id, allow: false })}
            >
              Deny
            </Button>
            <Button
              size="sm"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: a.id, allow: true })}
            >
              Allow
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Two-pane automation shell. Collapses to single column under 820px. */
export function AutomationPage({
  projectName,
  projectThreadId,
  section,
  actions,
  list,
  detail,
  onCloseDetail,
}: {
  projectName: string;
  projectThreadId?: string;
  section: string;
  actions?: ReactNode;
  list: ReactNode;
  detail?: ReactNode;
  onCloseDetail?: () => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
          {projectThreadId ? (
            <Link
              to="/$threadId"
              params={{ threadId: projectThreadId }}
              className="hover:text-foreground transition-colors"
            >
              {projectName}
            </Link>
          ) : (
            <span>{projectName}</span>
          )}
          <span className="mx-1.5 select-none opacity-50">/</span>
          <span className="font-bold text-foreground">{section}</span>
        </h1>
        {actions}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-border">{list}</div>
        {detail && (
          // Desktop: side pane. Mobile (<md): full-screen overlay above the list
          // with a Back affordance — without this the detail was simply hidden.
          <aside className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-background md:static md:inset-auto md:z-auto md:w-[340px] md:shrink-0 md:border-l md:border-border">
            {onCloseDetail && (
              <button
                onClick={onCloseDetail}
                className="flex items-center gap-1 border-b border-border px-4 py-3 text-left text-xs text-muted-foreground hover:text-foreground md:hidden"
                aria-label="Back to list"
              >
                ← Back
              </button>
            )}
            {detail}
          </aside>
        )}
      </div>
    </div>
  );
}

export function NoProject() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      Select a project from the sidebar to view its automation.
    </div>
  );
}

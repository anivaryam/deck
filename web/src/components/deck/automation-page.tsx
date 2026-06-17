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
}: {
  projectName: string;
  projectThreadId?: string;
  section: string;
  actions?: ReactNode;
  list: ReactNode;
  detail?: ReactNode;
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
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-border">{list}</div>
        {detail && <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto md:flex">{detail}</aside>}
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

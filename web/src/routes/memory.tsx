import { createFileRoute } from "@tanstack/react-router";
import { AsyncBoundary, useAuthRedirect } from "@/components/deck/async-boundary";
import { KnowledgeList } from "@/components/deck/knowledge-list";
import { NotificationsToggle } from "@/components/deck/notifications-toggle";
import { useKnowledge } from "@/hooks/use-automation-data";

export const Route = createFileRoute("/memory")({
  component: MemoryRoute,
});

function MemoryRoute() {
  const knowledgeQ = useKnowledge();
  useAuthRedirect(knowledgeQ.error);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
          <span>deck</span>
          <span className="mx-1.5 select-none opacity-50">/</span>
          <span className="font-bold text-foreground">Memory</span>
        </h1>
        <div className="flex items-center gap-1">
          <NotificationsToggle />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AsyncBoundary query={knowledgeQ} label="knowledge">
          <KnowledgeList facts={knowledgeQ.data ?? []} />
        </AsyncBoundary>
      </div>
    </div>
  );
}

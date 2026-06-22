import { createFileRoute } from "@tanstack/react-router";
import { AsyncBoundary, useAuthRedirect } from "@/components/deck/async-boundary";
import { ApprovalsList } from "@/components/deck/approvals-list";
import { Breadcrumb } from "@/components/deck/breadcrumb";
import { NotificationsToggle } from "@/components/deck/notifications-toggle";
import { useApprovals } from "@/hooks/use-automation-data";

export const Route = createFileRoute("/approvals")({
  component: ApprovalsRoute,
});

function ApprovalsRoute() {
  const approvalsQ = useApprovals();
  useAuthRedirect(approvalsQ.error);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <Breadcrumb mobile="back" items={[{ label: "deck", to: "/" }, { label: "Approvals" }]} />
        <div className="flex items-center gap-1">
          <NotificationsToggle />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AsyncBoundary query={approvalsQ} label="approvals">
          <ApprovalsList approvals={approvalsQ.data ?? []} />
        </AsyncBoundary>
      </div>
    </div>
  );
}

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useTaskEvents } from "@/lib/ws-events";
import { toastForTask } from "@/lib/automation-events";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 font-mono">
      <div className="max-w-md text-center">
        <div className="text-primary">$ cd /page</div>
        <h1 className="mt-2 text-5xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">no such file or directory</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm text-primary hover:bg-accent"
          >
            ~/ home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error }: { error: Error }) {
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 font-mono">
      <div className="max-w-md text-center">
        <div className="text-destructive">! runtime error</div>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm text-primary hover:bg-accent"
          >
            retry
          </button>
          <a href="/" className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-accent">
            home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/** Always-mounted hook: subscribes to the global task-event firehose and
 *  invalidates React Query caches + fires sonner toasts on completion. */
function TaskEventWatcher() {
  const qc = useQueryClient();
  useTaskEvents((frame) => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
    qc.invalidateQueries({ queryKey: ["cron"] });
    qc.invalidateQueries({ queryKey: ["runs"] });
    const t = toastForTask(frame);
    if (t) (t.intent === "error" ? toast.error : toast.success)(t.message);
  });
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <TaskEventWatcher />
        <Outlet />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

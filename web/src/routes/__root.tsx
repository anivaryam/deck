import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useTaskEvents } from "@/lib/ws-events";
import { toastForTask, TASK_FRAME_QUERY_KEYS } from "@/lib/automation-events";
import {
  notificationForTask,
  notificationsEnabled,
  notificationsSupported,
  registerServiceWorker,
  showNotification,
} from "@/lib/notifications";

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
 *  invalidates React Query caches + fires sonner toasts on completion.
 *  When the user has opted in and the tab is backgrounded, also raises a native
 *  browser/OS notification (works on mobile via the service worker). */
function TaskEventWatcher() {
  const qc = useQueryClient();

  // Register the service worker once so native notifications work on mobile
  // (Android Chrome only allows notifications shown via a SW registration).
  useEffect(() => {
    if (notificationsSupported()) void registerServiceWorker();
  }, []);

  useTaskEvents((frame) => {
    for (const key of TASK_FRAME_QUERY_KEYS) {
      qc.invalidateQueries({ queryKey: [key], type: "active" });
    }

    const t = toastForTask(frame);
    if (t) (t.intent === "error" ? toast.error : toast.success)(t.message);

    // Native notification only when the tab is hidden — otherwise the in-app
    // toast already covers it, and we avoid double-alerting the user.
    if (notificationsEnabled() && document.hidden) {
      const n = notificationForTask(frame);
      if (n) void showNotification(n.title, { body: n.body, tag: `task-${frame.id}` });
    }
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

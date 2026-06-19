import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError } from "@/lib/api";

/** Minimal shape shared by every TanStack query we gate on. */
interface QueryLike {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/** Redirect to the login gate when any passed query failed with a 401 — the cookie
 *  is missing/expired. Branches on the typed status, not the message text. */
export function useAuthRedirect(...errors: unknown[]): void {
  const navigate = useNavigate();
  // Depend on a derived boolean, not the spread `errors` rest-array: that array is
  // rebuilt every render (so the effect re-ran each commit) and a variable arity
  // across renders would trip React's "deps array length changed" invariant.
  const has401 = errors.some((e) => e instanceof ApiError && e.status === 401);
  useEffect(() => {
    if (has401) navigate({ to: "/login" });
  }, [has401, navigate]);
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Gate a list/detail region on its query state: spinner while loading, an error
 *  with retry on failure, otherwise the real content (which handles its own empty
 *  state). Prevents a slow or failed fetch from masquerading as "nothing here". */
export function AsyncBoundary({
  query,
  label,
  children,
}: {
  query: QueryLike;
  label: string;
  children: ReactNode;
}) {
  if (query.isLoading) {
    return (
      <Centered>
        <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        <span>Loading {label}…</span>
      </Centered>
    );
  }
  if (query.isError) {
    const msg = query.error instanceof Error ? query.error.message : "request failed";
    return (
      <Centered>
        <span className="text-destructive">Couldn’t load {label}</span>
        <span className="text-xs text-muted-foreground">{msg}</span>
        <button
          onClick={() => query.refetch()}
          className="mt-1 rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
        >
          Retry
        </button>
      </Centered>
    );
  }
  return <>{children}</>;
}

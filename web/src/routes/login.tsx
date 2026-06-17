import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/login")({
  component: LoginView,
});

function LoginView() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const ok = await api.login(token);
      if (ok) navigate({ to: "/" });
      else setError("wrong token");
    } catch {
      setError("login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-dvh place-items-center bg-background px-4 font-mono">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-4 border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
          <div className="text-primary">claude-deck v0.1.0</div>
          <div>authentication required · enter access token</div>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
          <span className="select-none text-sm font-medium text-primary">$</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="access token"
            aria-label="Access token"
            aria-invalid={!!error}
            autoComplete="current-password"
            autoFocus
            className="bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        {error && (
          <div role="alert" className="mt-2 px-1 text-xs text-destructive">
            ✕ {error}
          </div>
        )}

        <button
          disabled={busy || !token}
          className="mt-3 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-30"
        >
          {busy ? "authenticating…" : "enter"}
        </button>
      </form>
    </div>
  );
}

# Tasks / Cron / Tickets Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped web UI for deck's existing task, cron, and ticket backend features — three pages plus nested sidebar nav — using routes that already exist.

**Architecture:** TanStack file-based routes (`/tickets`, `/tasks`, `/cron`) read a `project` path from a search param. React Query hooks call new `api` client methods against existing backend routes. Pure presentation/transform logic lives in a testable `lib/automation.ts`. Task live output reuses the chat `MessageList` + `useSocket` + `eventsToMessages` pipeline, read-only. Visual identity: mono, single green accent, red only for failure.

**Tech Stack:** React 19, TanStack Router 1.168, React Query 5, Vitest (node env), Tailwind v4 + shadcn/ui, lucide-react.

---

## Important constraints (verified against the codebase)

- **Tests are pure-logic only.** `web/vitest.config.ts` uses `environment: "node"`; the repo has **no** jsdom / @testing-library. Do **not** add them. Automated tests cover `api` (fetch-mocked) and `lib/automation.ts` pure functions. Components/pages are verified by `pnpm typecheck` + manual smoke (browser). Follow the existing pure-function test style in `src/lib/artifacts.test.ts`.
- **No `GET /api/tickets/:id` route exists.** Ticket detail is rendered from the list item already in the React Query cache. Do not add a `ticket(id)` api method.
- **POST bodies want the project NAME, not path.** `resolveProjectPath(projectsRoots, project)` on the backend resolves a project *name*. List rows carry `project_path`. So: the URL search param is the project **path** (unique, matches the sidebar key); create/run forms resolve path → name via `useProjects()` before POSTing. (Same name-collision caveat that already exists for `createSession`; acceptable for this slice.)
- **`routeTree.gen.ts` is auto-generated** by the TanStack Vite plugin on dev/build — never hand-edit it. New files under `src/routes/` are picked up automatically.
- **Backend statuses are free-text.** Tickets default to `open`, become `running` on run. `review`/`done`/`failed` are forward-looking; the UI normalizes unknown values to the `open` style. Task sessions use `status: idle|active|errored` → mapped to done/running/failed.
- **Package manager:** use whatever the repo uses (`pnpm`). Run commands from `web/`.

---

## File Structure

**Create:**
- `web/src/lib/automation.ts` — pure helpers: status normalization, chip classes, relative time, project name lookup, list filters.
- `web/src/lib/automation.test.ts` — unit tests for the above.
- `web/src/lib/api.tickets-tasks-cron.test.ts` — fetch-mocked tests for new api methods.
- `web/src/hooks/use-automation-data.ts` — React Query hooks for tickets/tasks/cron.
- `web/src/components/deck/status-chip.tsx` — shared mono status dot + chip.
- `web/src/components/deck/tickets-list.tsx`
- `web/src/components/deck/ticket-detail.tsx`
- `web/src/components/deck/ticket-form.tsx`
- `web/src/components/deck/tasks-list.tsx`
- `web/src/components/deck/task-output.tsx`
- `web/src/components/deck/cron-list.tsx`
- `web/src/components/deck/cron-form.tsx`
- `web/src/components/deck/automation-page.tsx` — shared two-pane shell + "no project" empty state.
- `web/src/routes/tickets.tsx`, `web/src/routes/tasks.tsx`, `web/src/routes/cron.tsx`

**Modify:**
- `web/src/lib/types.ts` — add `Ticket`, `Cron`, `TaskDetail`.
- `web/src/lib/api.ts` — add methods.
- `web/src/components/deck/sidebar-projects.tsx` — nested Chats/Tickets/Tasks/Cron sub-sections.

---

## Task 1: Wire types

**Files:**
- Modify: `web/src/lib/types.ts` (append after `ImageAttachment`)

- [ ] **Step 1: Add backend wire types**

Append to `web/src/lib/types.ts`:

```ts
// ---- Automation wire types (mirror server/src/store.ts TicketRow / CronRow) ----
export interface Ticket {
  id: string;
  title: string;
  body: string | null;
  status: string; // free-text; 'open' | 'running' | 'review' | 'done' | 'failed'
  project_path: string;
  session_id: string | null;
  pr_url: string | null;
  created_at: number;
}

export interface Cron {
  id: string;
  schedule: string;
  project_path: string;
  prompt: string;
  enabled: number; // 0 | 1
  last_run_at: number | null;
  last_session_id: string | null;
  created_at: number;
}

// GET /api/tasks/:id returns the task Session plus its full event stream.
export interface TaskDetail extends Session {
  events: DeckMessage[];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && pnpm typecheck`
Expected: PASS (no usages yet, just declarations).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts
git commit -m "feat(web): add Ticket/Cron/TaskDetail wire types"
```

---

## Task 2: API client methods (TDD, fetch-mocked)

**Files:**
- Create: `web/src/lib/api.tickets-tasks-cron.test.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/api.tickets-tasks-cron.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("automation api methods", () => {
  it("tickets() GETs /api/tickets with cookies", async () => {
    const f = mockFetch(200, [{ id: "t1", title: "x" }]);
    vi.stubGlobal("fetch", f);
    const out = await api.tickets();
    expect(f).toHaveBeenCalledWith("/api/tickets", { credentials: "same-origin" });
    expect(out).toEqual([{ id: "t1", title: "x" }]);
  });

  it("createTicket() POSTs title/body/project as JSON", async () => {
    const f = mockFetch(200, { id: "t2" });
    vi.stubGlobal("fetch", f);
    await api.createTicket({ project: "deck", title: "Fix", body: "do it" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/tickets");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ project: "deck", title: "Fix", body: "do it" });
  });

  it("runTicket() POSTs to the run subroute", async () => {
    const f = mockFetch(200, { session_id: "s1" });
    vi.stubGlobal("fetch", f);
    const out = await api.runTicket("t1");
    expect(f.mock.calls[0][0]).toBe("/api/tickets/t1/run");
    expect(out).toEqual({ session_id: "s1" });
  });

  it("createCron() surfaces backend validation error as ApiError", async () => {
    const f = mockFetch(400, { error: "invalid cron expression" });
    vi.stubGlobal("fetch", f);
    await expect(
      api.createCron({ schedule: "nope", project: "deck", prompt: "x" }),
    ).rejects.toMatchObject({ status: 400, message: "invalid cron expression" } as ApiError);
  });

  it("updateCron() PATCHes enabled", async () => {
    const f = mockFetch(200, { id: "c1", enabled: 0 });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", false);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/cron/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it("deleteCron() DELETEs and tolerates 204", async () => {
    const f = mockFetch(204, undefined);
    vi.stubGlobal("fetch", f);
    await api.deleteCron("c1");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });

  it("createTask() POSTs project/prompt and returns {id}", async () => {
    const f = mockFetch(200, { id: "task1" });
    vi.stubGlobal("fetch", f);
    const out = await api.createTask({ project: "deck", prompt: "go" });
    expect(out).toEqual({ id: "task1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/api.tickets-tasks-cron.test.ts`
Expected: FAIL — `api.tickets is not a function` (methods not defined yet).

- [ ] **Step 3: Add the methods**

In `web/src/lib/api.ts`, change the import line to:

```ts
import type { Cron, Project, Session, Ticket, TaskDetail } from "./types";
```

Then insert these methods inside the `api` object, before the closing `};` (after `upload`):

```ts
  // ---- tasks ----
  async tasks(): Promise<Session[]> {
    return json(await fetch("/api/tasks", { credentials: "same-origin" }));
  },
  async task(id: string): Promise<TaskDetail> {
    return json(await fetch(`/api/tasks/${id}`, { credentials: "same-origin" }));
  },
  async createTask(body: {
    project: string;
    prompt: string;
    model?: string;
    effort?: string;
  }): Promise<{ id: string }> {
    return json(
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },

  // ---- cron ----
  async listCron(): Promise<Cron[]> {
    return json(await fetch("/api/cron", { credentials: "same-origin" }));
  },
  async createCron(body: {
    schedule: string;
    project: string;
    prompt: string;
  }): Promise<Cron> {
    return json(
      await fetch("/api/cron", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async updateCron(id: string, enabled: boolean): Promise<Cron> {
    return json(
      await fetch(`/api/cron/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
        credentials: "same-origin",
      }),
    );
  },
  async deleteCron(id: string): Promise<void> {
    const res = await fetch(`/api/cron/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        const b = await res.json();
        if (b?.error) msg = b.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
  },

  // ---- tickets (no GET :id route — detail comes from the list) ----
  async tickets(): Promise<Ticket[]> {
    return json(await fetch("/api/tickets", { credentials: "same-origin" }));
  },
  async createTicket(body: {
    project: string;
    title: string;
    body?: string;
  }): Promise<Ticket> {
    return json(
      await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async updateTicket(
    id: string,
    patch: { status?: string; pr_url?: string },
  ): Promise<Ticket> {
    return json(
      await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        credentials: "same-origin",
      }),
    );
  },
  async runTicket(id: string): Promise<{ session_id: string }> {
    return json(
      await fetch(`/api/tickets/${id}/run`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/api.tickets-tasks-cron.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.tickets-tasks-cron.test.ts
git commit -m "feat(web): add tickets/tasks/cron api client methods"
```

---

## Task 3: Pure presentation helpers (TDD)

**Files:**
- Create: `web/src/lib/automation.ts`
- Create: `web/src/lib/automation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/automation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeTicketStatus,
  taskStatus,
  statusDotClass,
  statusChipClass,
  relativeTime,
  projectNameForPath,
  byProjectPath,
  TICKET_TABS,
  filterTicketsByTab,
} from "./automation";
import type { Session, Ticket } from "./types";

describe("normalizeTicketStatus", () => {
  it("passes through known statuses", () => {
    expect(normalizeTicketStatus("review")).toBe("review");
    expect(normalizeTicketStatus("failed")).toBe("failed");
  });
  it("falls back to open for unknown/empty", () => {
    expect(normalizeTicketStatus("weird")).toBe("open");
    expect(normalizeTicketStatus("")).toBe("open");
  });
});

describe("taskStatus", () => {
  it("maps session status to a normalized automation status", () => {
    expect(taskStatus({ status: "active" } as Session)).toBe("running");
    expect(taskStatus({ status: "errored" } as Session)).toBe("failed");
    expect(taskStatus({ status: "idle" } as Session)).toBe("done");
  });
});

describe("status classes", () => {
  it("uses destructive only for failed", () => {
    expect(statusDotClass("failed")).toContain("destructive");
    expect(statusDotClass("running")).not.toContain("destructive");
    expect(statusChipClass("failed")).toContain("destructive");
  });
});

describe("relativeTime", () => {
  it("formats recent timestamps", () => {
    const now = 10_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
  it("renders null as a dash", () => {
    expect(relativeTime(null, 1)).toBe("—");
  });
});

describe("projectNameForPath / byProjectPath", () => {
  const projects = [
    { name: "deck", path: "/p/deck" },
    { name: "merge-port", path: "/p/mp" },
  ];
  it("resolves a name from a path", () => {
    expect(projectNameForPath(projects, "/p/deck")).toBe("deck");
    expect(projectNameForPath(projects, "/p/none")).toBeNull();
  });
  it("filters rows by project_path", () => {
    const rows = [{ project_path: "/p/deck" }, { project_path: "/p/mp" }] as Ticket[];
    expect(byProjectPath(rows, "/p/deck")).toHaveLength(1);
  });
});

describe("filterTicketsByTab", () => {
  const rows = [
    { status: "open" },
    { status: "running" },
    { status: "review" },
  ] as Ticket[];
  it("returns all for the 'all' tab", () => {
    expect(filterTicketsByTab(rows, "all")).toHaveLength(3);
  });
  it("filters by normalized status", () => {
    expect(filterTicketsByTab(rows, "running")).toHaveLength(1);
  });
  it("exposes the tab list", () => {
    expect(TICKET_TABS[0]).toBe("all");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/automation.test.ts`
Expected: FAIL — cannot find module `./automation`.

- [ ] **Step 3: Implement the helpers**

Create `web/src/lib/automation.ts`:

```ts
import type { Project, Session, Ticket } from "./types";

export type AutomationStatus = "open" | "running" | "review" | "done" | "failed";

const KNOWN: AutomationStatus[] = ["open", "running", "review", "done", "failed"];

export function normalizeTicketStatus(s: string | null | undefined): AutomationStatus {
  const v = (s ?? "").toLowerCase();
  return (KNOWN as string[]).includes(v) ? (v as AutomationStatus) : "open";
}

/** Map a task Session's lifecycle status onto an automation status. */
export function taskStatus(s: Pick<Session, "status">): AutomationStatus {
  if (s.status === "active") return "running";
  if (s.status === "errored") return "failed";
  return "done";
}

/** Status dot: shape + green intensity; destructive (red) only for failure. */
export function statusDotClass(s: AutomationStatus): string {
  switch (s) {
    case "open":
      return "border border-muted-foreground bg-transparent";
    case "running":
      return "bg-primary shadow-[0_0_8px_var(--color-primary)] animate-pulse";
    case "review":
      return "border border-primary bg-transparent";
    case "done":
      return "bg-primary/60";
    case "failed":
      return "bg-destructive";
  }
}

/** Status chip text/bg. Same palette discipline. */
export function statusChipClass(s: AutomationStatus): string {
  switch (s) {
    case "open":
      return "bg-muted text-muted-foreground";
    case "running":
      return "bg-primary/15 text-primary";
    case "review":
      return "border border-primary/40 text-primary";
    case "done":
      return "border border-border text-muted-foreground";
    case "failed":
      return "bg-destructive/15 text-destructive";
  }
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function relativeTime(at: number | null | undefined, now: number = Date.now()): string {
  if (at == null) return "—";
  const d = now - at;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  return `${Math.floor(d / DAY)}d ago`;
}

export function projectNameForPath(projects: Project[], path: string): string | null {
  return projects.find((p) => p.path === path)?.name ?? null;
}

export function byProjectPath<T extends { project_path: string }>(rows: T[], path: string): T[] {
  return rows.filter((r) => r.project_path === path);
}

export const TICKET_TABS = ["all", "open", "running", "review", "done", "failed"] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

export function filterTicketsByTab(rows: Ticket[], tab: TicketTab): Ticket[] {
  if (tab === "all") return rows;
  return rows.filter((t) => normalizeTicketStatus(t.status) === tab);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/automation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/automation.ts web/src/lib/automation.test.ts
git commit -m "feat(web): add pure automation presentation helpers"
```

---

## Task 4: React Query hooks

**Files:**
- Create: `web/src/hooks/use-automation-data.ts`

- [ ] **Step 1: Write the hooks**

Create `web/src/hooks/use-automation-data.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---- queries ----
export function useTickets() {
  return useQuery({ queryKey: ["tickets"], queryFn: () => api.tickets() });
}

export function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks(), refetchInterval: 5_000 });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => (id ? api.task(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}

export function useCron() {
  return useQuery({ queryKey: ["cron"], queryFn: () => api.listCron() });
}

// ---- mutations ----
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { project: string; title: string; body?: string }) => api.createTicket(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { status?: string; pr_url?: string } }) =>
      api.updateTicket(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useRunTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runTicket(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { project: string; prompt: string; model?: string; effort?: string }) =>
      api.createTask(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useCreateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { schedule: string; project: string; prompt: string }) => api.createCron(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useUpdateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) => api.updateCron(args.id, args.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useDeleteCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCron(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/use-automation-data.ts
git commit -m "feat(web): add react-query hooks for tickets/tasks/cron"
```

---

## Task 5: Shared status chip + page shell

**Files:**
- Create: `web/src/components/deck/status-chip.tsx`
- Create: `web/src/components/deck/automation-page.tsx`

- [ ] **Step 1: Write the status chip**

Create `web/src/components/deck/status-chip.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { statusChipClass, statusDotClass, type AutomationStatus } from "@/lib/automation";

export function StatusDot({ status, className }: { status: AutomationStatus; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", statusDotClass(status), className)} />;
}

export function StatusChip({ status, label }: { status: AutomationStatus; label?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        statusChipClass(status),
      )}
    >
      {label ?? status}
    </span>
  );
}
```

- [ ] **Step 2: Write the page shell**

Create `web/src/components/deck/automation-page.tsx`:

```tsx
import type { ReactNode } from "react";

/** Two-pane automation shell. Collapses to single column under 820px. */
export function AutomationPage({
  title,
  actions,
  list,
  detail,
}: {
  title: string;
  actions?: ReactNode;
  list: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="text-sm font-bold tracking-tight">{title}</h1>
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
```

- [ ] **Step 3: Typecheck**

Run: `cd web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/deck/status-chip.tsx web/src/components/deck/automation-page.tsx
git commit -m "feat(web): add status chip + automation page shell"
```

---

## Task 6: Tickets page

**Files:**
- Create: `web/src/components/deck/ticket-form.tsx`
- Create: `web/src/components/deck/ticket-detail.tsx`
- Create: `web/src/components/deck/tickets-list.tsx`
- Create: `web/src/routes/tickets.tsx`

- [ ] **Step 1: Ticket create form**

Create `web/src/components/deck/ticket-form.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateTicket } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function TicketForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateTicket();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ project: projectName, title, body: body || undefined });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create ticket");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Ticket title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Details (markdown)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title || create.isPending}>
          {create.isPending ? "Creating…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Ticket detail pane**

Create `web/src/components/deck/ticket-detail.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./status-chip";
import { useRunTicket } from "@/hooks/use-automation-data";
import { normalizeTicketStatus, relativeTime } from "@/lib/automation";
import type { Ticket } from "@/lib/types";

export function TicketDetail({ ticket }: { ticket: Ticket }) {
  const run = useRunTicket();
  const status = normalizeTicketStatus(ticket.status);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="mb-2">
          <StatusChip status={status} />
        </div>
        <h2 className="text-sm font-bold leading-snug">{ticket.title}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-xs text-muted-foreground">
        {ticket.body && <p className="mb-3 whitespace-pre-wrap leading-relaxed">{ticket.body}</p>}
        <Row k="status" v={status} />
        {ticket.pr_url && (
          <Row
            k="PR"
            v={
              <a className="text-primary" href={ticket.pr_url} target="_blank" rel="noreferrer">
                link ↗
              </a>
            }
          />
        )}
        <Row k="created" v={relativeTime(ticket.created_at)} />
        {ticket.session_id && (
          <Link
            to="/tasks"
            search={{ project: ticket.project_path }}
            className="mt-3 flex items-center gap-2 rounded-md border border-border bg-card p-3 text-[11px] text-primary"
          >
            ▸ linked task · view live output
          </Link>
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-4">
        <Button
          className="flex-1"
          disabled={run.isPending}
          onClick={() => run.mutate(ticket.id)}
        >
          {run.isPending ? "Starting…" : "▶ Run"}
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}
```

- [ ] **Step 3: Tickets list**

Create `web/src/components/deck/tickets-list.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "./status-chip";
import { normalizeTicketStatus, relativeTime, type TicketTab } from "@/lib/automation";
import type { Ticket } from "@/lib/types";

export function TicketsList({
  tickets,
  tabs,
  activeTab,
  onTab,
  selectedId,
  onSelect,
}: {
  tickets: Ticket[];
  tabs: readonly TicketTab[];
  activeTab: TicketTab;
  onTab: (t: TicketTab) => void;
  selectedId: string | null;
  onSelect: (t: Ticket) => void;
}) {
  return (
    <>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2.5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            className={cn(
              "whitespace-nowrap rounded-full border border-transparent px-3 py-1 text-xs capitalize text-muted-foreground",
              activeTab === t && "border-border bg-accent text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="p-2">
        {tickets.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No tickets.</p>
        )}
        {tickets.map((t) => {
          const status = normalizeTicketStatus(t.status);
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border border-transparent px-3.5 py-3 text-left",
                selectedId === t.id ? "border-border bg-card" : "hover:border-border hover:bg-card",
              )}
            >
              <StatusDot status={status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{t.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {relativeTime(t.created_at)}
                </span>
              </span>
              <StatusChip status={status} />
            </button>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Tickets route**

Create `web/src/routes/tickets.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { TicketsList } from "@/components/deck/tickets-list";
import { TicketDetail } from "@/components/deck/ticket-detail";
import { TicketForm } from "@/components/deck/ticket-form";
import { useTickets } from "@/hooks/use-automation-data";
import { useProjects } from "@/hooks/use-deck-data";
import {
  byProjectPath,
  filterTicketsByTab,
  projectNameForPath,
  TICKET_TABS,
  type TicketTab,
} from "@/lib/automation";

export const Route = createFileRoute("/tickets")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: TicketsRoute,
});

function TicketsRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const { data } = useTickets();
  const [tab, setTab] = useState<TicketTab>("all");
  const [selId, setSelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(
    () => filterTicketsByTab(byProjectPath(data ?? [], project), tab),
    [data, project, tab],
  );
  const selected = (data ?? []).find((t) => t.id === selId) ?? null;

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      title={`Tickets · ${name ?? project}`}
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>
          + New ticket
        </Button>
      }
      list={
        creating && name ? (
          <TicketForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <TicketsList
            tickets={rows}
            tabs={TICKET_TABS}
            activeTab={tab}
            onTab={setTab}
            selectedId={selId}
            onSelect={(t) => setSelId(t.id)}
          />
        )
      }
      detail={selected ? <TicketDetail ticket={selected} /> : undefined}
    />
  );
}
```

- [ ] **Step 5: Typecheck + dev smoke**

Run: `cd web && pnpm typecheck`
Expected: PASS.

Then with the stack running (`proc-compose up`), open `/tickets?project=<an-existing-project-path>`:
- list renders, filter tabs switch, **+ New ticket** creates and the row appears,
- selecting a ticket shows the detail pane, **Run** flips it to running.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/deck/ticket-form.tsx web/src/components/deck/ticket-detail.tsx web/src/components/deck/tickets-list.tsx web/src/routes/tickets.tsx
git commit -m "feat(web): tickets page (list, detail, run, create)"
```

---

## Task 7: Tasks page

**Files:**
- Create: `web/src/components/deck/task-output.tsx`
- Create: `web/src/components/deck/tasks-list.tsx`
- Create: `web/src/routes/tasks.tsx`

- [ ] **Step 1: Read-only task output (reuse MessageList + useSocket)**

Create `web/src/components/deck/task-output.tsx`:

```tsx
import { useMemo } from "react";
import { MessageList } from "./message-list";
import { useSocket } from "@/lib/ws";
import { eventsToMessages } from "@/lib/adapt";

/** Live, read-only render of a task session's event stream. No composer. */
export function TaskOutput({ taskId }: { taskId: string }) {
  const { messages: raw } = useSocket(taskId);
  const messages = useMemo(() => eventsToMessages(raw), [raw]);
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      {messages.length === 0 ? (
        <p className="m-auto text-sm text-muted-foreground">No output yet.</p>
      ) : (
        <MessageList messages={messages} sessionId={taskId} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Tasks list**

Create `web/src/components/deck/tasks-list.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "./status-chip";
import { relativeTime, taskStatus } from "@/lib/automation";
import type { Session } from "@/lib/types";

export function TasksList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Session[];
  selectedId: string | null;
  onSelect: (t: Session) => void;
}) {
  if (tasks.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No tasks.</p>;
  }
  return (
    <div className="p-2">
      {tasks.map((t) => {
        const status = taskStatus(t);
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border border-transparent px-3.5 py-3 text-left",
              selectedId === t.id ? "border-border bg-card" : "hover:border-border hover:bg-card",
            )}
          >
            <StatusDot status={status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {t.title ?? t.prompt ?? t.id}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {relativeTime(t.created_at)}
              </span>
            </span>
            {t.origin && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                {t.origin}
              </span>
            )}
            <StatusChip status={status} />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Tasks route**

Create `web/src/routes/tasks.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { TasksList } from "@/components/deck/tasks-list";
import { TaskOutput } from "@/components/deck/task-output";
import { useTasks } from "@/hooks/use-automation-data";
import { useProjects } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/tasks")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: TasksRoute,
});

function TasksRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const { data } = useTasks();
  const [selId, setSelId] = useState<string | null>(null);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      title={`Tasks · ${name ?? project}`}
      list={<TasksList tasks={rows} selectedId={selId} onSelect={(t) => setSelId(t.id)} />}
      detail={selId ? <TaskOutput taskId={selId} /> : undefined}
    />
  );
}
```

- [ ] **Step 4: Typecheck + dev smoke**

Run: `cd web && pnpm typecheck`
Expected: PASS.

Smoke: open `/tasks?project=<path>`. Run a ticket (Task 6) or create a manual task via API, confirm it appears, select it, and output streams live via the WebSocket exactly like a chat (no input box).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/deck/task-output.tsx web/src/components/deck/tasks-list.tsx web/src/routes/tasks.tsx
git commit -m "feat(web): tasks page with live read-only output"
```

---

## Task 8: Cron page

**Files:**
- Create: `web/src/components/deck/cron-form.tsx`
- Create: `web/src/components/deck/cron-list.tsx`
- Create: `web/src/routes/cron.tsx`

- [ ] **Step 1: Cron form (inline validation error)**

Create `web/src/components/deck/cron-form.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateCron } from "@/hooks/use-automation-data";
import { ApiError } from "@/lib/api";

export function CronForm({ projectName, onDone }: { projectName: string; onDone: () => void }) {
  const [schedule, setSchedule] = useState("0 3 * * *");
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateCron();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ schedule, project: projectName, prompt });
      onDone();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "failed to create cron");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <input
        autoFocus
        className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm"
        placeholder="cron expression e.g. 0 3 * * *"
        value={schedule}
        onChange={(e) => setSchedule(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
        placeholder="Prompt to run on schedule"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        required
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!schedule || !prompt || create.isPending}>
          {create.isPending ? "Creating…" : "Create cron"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Cron list (toggle + delete)**

Create `web/src/components/deck/cron-list.tsx`:

```tsx
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useDeleteCron, useUpdateCron } from "@/hooks/use-automation-data";
import { relativeTime } from "@/lib/automation";
import type { Cron } from "@/lib/types";

export function CronList({ crons }: { crons: Cron[] }) {
  const toggle = useUpdateCron();
  const del = useDeleteCron();

  if (crons.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No cron schedules.</p>;
  }
  return (
    <div className="p-2">
      {crons.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md border border-transparent px-3.5 py-3 hover:border-border hover:bg-card">
          <Switch
            checked={c.enabled === 1}
            onCheckedChange={(v) => toggle.mutate({ id: c.id, enabled: v })}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-sm text-foreground">{c.schedule}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{c.prompt}</span>
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            last: {relativeTime(c.last_run_at)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => del.mutate(c.id)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}
```

> If `@/components/ui/switch` does not export `Switch` with an `onCheckedChange` prop, check the file — it is shadcn/Radix Switch (verified present at `web/src/components/ui/switch.tsx`) and uses exactly this API.

- [ ] **Step 3: Cron route**

Create `web/src/routes/cron.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AutomationPage, NoProject } from "@/components/deck/automation-page";
import { CronList } from "@/components/deck/cron-list";
import { CronForm } from "@/components/deck/cron-form";
import { useCron } from "@/hooks/use-automation-data";
import { useProjects } from "@/hooks/use-deck-data";
import { byProjectPath, projectNameForPath } from "@/lib/automation";

export const Route = createFileRoute("/cron")({
  validateSearch: (s: Record<string, unknown>) => ({ project: String(s.project ?? "") }),
  component: CronRoute,
});

function CronRoute() {
  const { project } = Route.useSearch();
  const projects = useProjects();
  const { data } = useCron();
  const [creating, setCreating] = useState(false);

  const name = projects.data ? projectNameForPath(projects.data, project) : null;
  const rows = useMemo(() => byProjectPath(data ?? [], project), [data, project]);

  if (!project) return <NoProject />;

  return (
    <AutomationPage
      title={`Cron · ${name ?? project}`}
      actions={
        <Button disabled={!name} onClick={() => setCreating(true)}>
          + New cron
        </Button>
      }
      list={
        creating && name ? (
          <CronForm projectName={name} onDone={() => setCreating(false)} />
        ) : (
          <CronList crons={rows} />
        )
      }
    />
  );
}
```

- [ ] **Step 4: Typecheck + dev smoke**

Run: `cd web && pnpm typecheck`
Expected: PASS.

Smoke: open `/cron?project=<path>`, create a schedule (try an invalid expression → inline "invalid cron expression"), toggle enabled (persists across refresh), delete.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/deck/cron-form.tsx web/src/components/deck/cron-list.tsx web/src/routes/cron.tsx
git commit -m "feat(web): cron page (list, toggle, create, delete)"
```

---

## Task 9: Sidebar nested sub-sections

**Files:**
- Modify: `web/src/components/deck/sidebar-projects.tsx`

This adds Tickets/Tasks/Cron links beneath each expanded project. The existing Chats list stays exactly as-is. Read the file first to match its current markup; the change is additive.

- [ ] **Step 1: Add the sub-section links**

Inside the per-project expanded block (where the sessions `<ul>` currently renders, after the project toggle button), add a small nav row group above or below the chats list. Use TanStack `Link` with the project path as search param:

```tsx
// at top of file, ensure these imports exist:
import { Link } from "@tanstack/react-router";
import { Ticket as TicketIcon, ListChecks, Clock } from "lucide-react";

// inside the expanded project body (project has `.path`):
<div className="ml-4 border-l border-sidebar-border pl-2">
  <Link
    to="/tickets"
    search={{ project: project.path }}
    onClick={onNavigate}
    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
  >
    <TicketIcon className="size-3.5" /> Tickets
  </Link>
  <Link
    to="/tasks"
    search={{ project: project.path }}
    onClick={onNavigate}
    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
  >
    <ListChecks className="size-3.5" /> Tasks
  </Link>
  <Link
    to="/cron"
    search={{ project: project.path }}
    onClick={onNavigate}
    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
  >
    <Clock className="size-3.5" /> Cron
  </Link>
</div>
```

> Counts (badges) are optional polish; omit for this slice to avoid extra fetching per project. The Chats list is the existing sessions list — leave it unchanged.

- [ ] **Step 2: Typecheck + dev smoke**

Run: `cd web && pnpm typecheck`
Expected: PASS.

Smoke: expand a project in the sidebar → Tickets / Tasks / Cron links appear and navigate to the right page with the project preselected. Active link highlights green.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/deck/sidebar-projects.tsx
git commit -m "feat(web): nested tickets/tasks/cron nav under each project"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the whole web test suite**

Run: `cd web && pnpm test`
Expected: PASS (existing artifacts tests + new api + automation tests).

- [ ] **Step 2: Typecheck + build**

Run: `cd web && pnpm typecheck && pnpm build`
Expected: both succeed; `routeTree.gen.ts` regenerated with the 3 new routes.

- [ ] **Step 3: End-to-end manual smoke (stack up via `proc-compose up`)**

Walk the loop:
1. Sidebar → expand project → Tickets.
2. New ticket → it appears in the list.
3. Select it → Run → status flips to running.
4. Tasks → the ticket-origin task appears → select → output streams live.
5. Cron → create a schedule (and confirm an invalid expression errors inline) → toggle → delete.
6. Resize narrow (<820px): panes collapse to single column.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(web): automation UI verification pass"
```

---

## Self-Review (completed)

- **Spec coverage:** nav option-B (Task 9), routes w/ project search param (6/7/8), api methods (2), hooks (4), tickets list+detail+form+Run (6), tasks list + MessageList reuse via useSocket (7), cron list+toggle+form+validation (8), shared mono status-chip (5), empty/error states (5,6,8), types (1), tests (2,3,10). All covered.
- **Spec correction:** spec listed `api.ticket(id)` and `useTicket(id)`; no such backend route exists — ticket detail is taken from the list cache (`selected = data.find(...)`). Plan reflects this.
- **Placeholder scan:** none — every code step has full content.
- **Type consistency:** `AutomationStatus` used uniformly; `StatusDot`/`StatusChip` props match `statusDotClass`/`statusChipClass`; hook arg shapes match api method signatures; `project` search param is the path everywhere, resolved to name via `projectNameForPath` before POSTs.
- **Test reality:** node-env Vitest only; no component-render tests invented. Pure logic + fetch-mocked api are unit-tested; UI verified by typecheck + manual smoke, matching repo conventions.

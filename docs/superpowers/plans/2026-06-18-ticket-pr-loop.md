# Close the Ticket → PR Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire ticket run outcomes to a ticket state machine and auto-capture the PR a ticket run opens, so a human only reviews/merges.

**Architecture:** A decoupled `ticketAutomation` listener subscribes to the manager's existing `task` lifecycle events and transitions the ticket (`open→running→review/done→failed`, `cancelled→open`). A new `link_pr` MCP tool — registered only for ticket-origin tasks — lets the agent record its PR URL; a fallback event-scan covers a forgotten call. The ticket run prompt instructs the branch+PR+link_pr workflow.

**Tech Stack:** Backend — Fastify, better-sqlite3, EventEmitter `SessionManager`, `@anthropic-ai/claude-agent-sdk` MCP (`createSdkMcpServer`/`tool`/`zod`), Vitest. Frontend — React, TanStack Router, React Query, Vitest (node env).

---

## Constraints (verified)

- Backend `manager.on('task', frame)` emits `{id, source_kind, source_id, status, result}` (run-history slice). Terminal frames carry `result ∈ {success,error,cancelled,queue_full}`; start frame is `status:'active', result:null`.
- `buildDeckMcp(store, projectPath)` in `server/src/deckTools.ts` is built per session at `sessionManager.ts:156` (`mcpServers: { deck: buildDeckMcp(this.store, sess.project_path) }`).
- `store.updateTicket(id, { status?, pr_url?, session_id?, title?, body? })` and `store.getTicket(id)` exist. Ticket statuses are free-text TEXT (default `'open'`).
- Ticket run route: `server/src/routes.ts` `POST /api/tickets/:id/run` builds the prompt and calls `runner.run({origin:'ticket', sourceKind:'ticket', sourceId:tk.id})`.
- `server.ts` wires store/manager/runner/scheduler (lines 22-25) and `registerWs(app, …)` (line 38).
- `store.eventsSince(id, 0)` returns recorded events (each has a `payload`).
- Frontend `web/src/lib/automation.ts`: `AutomationStatus = open|running|review|done|failed`, `KNOWN` array, `statusDotClass`/`statusChipClass` exhaustive switches (no `default` — every union member needs a case or tsc errors), `TICKET_TABS`.
- Tests: backend Vitest `new Store(':memory:')` + fake EventEmitter manager; frontend node-env Vitest (no jsdom). Run pnpm from `server/` or `web/`. After web route/type changes run `pnpm build` to regenerate `src/routeTree.gen.ts` before `pnpm exec tsc --noEmit --incremental false`. Don't commit `routeTree.gen.ts`/`dist/`.
- Work in a git worktree on a feature branch (controller sets up).

---

## File Structure

**Backend — modify:** `server/src/deckTools.ts` (+`link_pr`, `ticketId` param + handler), `server/src/sessionManager.ts` (pass ticketId), `server/src/routes.ts` (augment ticket prompt), `server/src/server.ts` (wire listener).
**Backend — create:** `server/src/ticketAutomation.ts` (listener), `server/test/ticketLoop.test.ts`.
**Frontend — modify:** `web/src/lib/automation.ts` (statuses), `web/src/components/deck/ticket-detail.tsx` (merged/close buttons), `web/src/lib/automation.test.ts` (extend).

---

## Task 1: `link_pr` MCP tool + ticket-scoped buildDeckMcp (TDD)

**Files:** Modify `server/src/deckTools.ts`; Create `server/test/ticketLoop.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ticketLoop.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { linkPrHandler, buildDeckMcp } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('link_pr handler', () => {
  it('records a valid GitHub PR URL on the ticket', async () => {
    const tk = store.createTicket({ title: 'x', projectPath: '/p' });
    const res = await linkPrHandler(store, tk.id, { url: 'https://github.com/o/r/pull/12' });
    expect(store.getTicket(tk.id)!.pr_url).toBe('https://github.com/o/r/pull/12');
    expect(res.content[0].text).toMatch(/recorded|linked/i);
  });

  it('rejects a non-PR URL without writing', async () => {
    const tk = store.createTicket({ title: 'x', projectPath: '/p' });
    await linkPrHandler(store, tk.id, { url: 'https://example.com/foo' });
    expect(store.getTicket(tk.id)!.pr_url == null).toBe(true);
  });
});

describe('buildDeckMcp tool scoping', () => {
  it('omits link_pr when no ticketId is given', () => {
    const mcp = buildDeckMcp(store, '/p') as any;
    const names = mcp.options.tools.map((t: any) => t.name);
    expect(names).toContain('create_ticket');
    expect(names).not.toContain('link_pr');
  });

  it('includes link_pr when a ticketId is given', () => {
    const mcp = buildDeckMcp(store, '/p', 'ticket-1') as any;
    const names = mcp.options.tools.map((t: any) => t.name);
    expect(names).toContain('link_pr');
  });
});
```

> The `mcp.options.tools` access shape is an assumption about `createSdkMcpServer`'s return. **Before writing the impl, verify it** by logging `Object.keys(buildDeckMcp(store,'/p'))` / its `.tools` location in a scratch run; if the tool list lives elsewhere (e.g. `mcp.tools` or not introspectable), adjust the test to assert scoping a different way — e.g. export a pure `deckToolNames(ticketId?)` helper that returns the name list and have `buildDeckMcp` use it, then test that helper directly. Prefer the pure-helper approach if the SDK object isn't introspectable.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && pnpm vitest run test/ticketLoop.test.ts`
Expected: FAIL — `linkPrHandler` not exported.

- [ ] **Step 3: Implement**

In `server/src/deckTools.ts` add the handler and a PR-URL validator, and extend `buildDeckMcp`:

```ts
const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/;

export async function linkPrHandler(
  store: Store, ticketId: string, args: { url: string },
): Promise<ToolResult> {
  if (!PR_URL.test(args.url)) {
    return { content: [{ type: 'text', text: `Not a GitHub PR URL: ${args.url}` }] };
  }
  store.updateTicket(ticketId, { pr_url: args.url });
  return { content: [{ type: 'text', text: `PR linked to ticket ${ticketId}: ${args.url}` }] };
}
```

Change `buildDeckMcp` to take an optional `ticketId` and conditionally include `link_pr`:

```ts
export function buildDeckMcp(store: Store, projectPath: string, ticketId?: string) {
  const tools = [
    tool('create_ticket', 'File a claude-deck ticket for the CURRENT project. Use one ticket per distinct gap/issue/follow-up you find.',
      { title: z.string().describe('Short imperative title'), body: z.string().optional().describe('Details: what, why, where (file:line)') },
      async (args) => createTicketHandler(store, projectPath, args)),
    tool('list_tickets', 'List existing claude-deck tickets for the current project (check before creating to avoid duplicates).',
      {}, async () => listTicketsHandler(store, projectPath)),
  ];
  if (ticketId) {
    tools.push(
      tool('link_pr', 'Record the GitHub Pull Request URL you opened for the CURRENT ticket. Call this once the PR exists.',
        { url: z.string().describe('Full GitHub PR URL, e.g. https://github.com/o/r/pull/123') },
        async (args) => linkPrHandler(store, ticketId, args)),
    );
  }
  return createSdkMcpServer({ name: 'deck', version: '1.0.0', instructions: 'Tools to file/list claude-deck tickets and link a PR for the current ticket.', tools });
}
```

- [ ] **Step 4: Run — expect PASS** (adjust the scoping assertion per the Step 1 note if the SDK object isn't introspectable)

Run: `cd server && pnpm vitest run test/ticketLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/deckTools.ts server/test/ticketLoop.test.ts
git commit -m "feat(server): link_pr MCP tool scoped to ticket runs"
```

---

## Task 2: sessionManager passes ticketId

**Files:** Modify `server/src/sessionManager.ts`.

- [ ] **Step 1: Edit the mcpServers line**

At `sessionManager.ts:156`, change:

```ts
        mcpServers: { deck: buildDeckMcp(this.store, sess.project_path) },
```
to:
```ts
        mcpServers: {
          deck: buildDeckMcp(
            this.store,
            sess.project_path,
            sess.source_kind === 'ticket' && sess.source_id ? sess.source_id : undefined,
          ),
        },
```

- [ ] **Step 2: Typecheck**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/sessionManager.ts
git commit -m "feat(server): expose link_pr to ticket-origin task runs"
```

---

## Task 3: `ticketAutomation` listener — transitions + PR fallback (TDD)

**Files:** Create `server/src/ticketAutomation.ts`; extend `server/test/ticketLoop.test.ts`.

- [ ] **Step 1: Add failing tests**

Append to `server/test/ticketLoop.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { registerTicketAutomation } from '../src/ticketAutomation.ts';

function wire(store: Store) {
  const mgr = new EventEmitter();
  registerTicketAutomation(mgr as any, store);
  return mgr;
}

describe('ticketAutomation transitions', () => {
  it('start frame → running', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'active', result: null });
    expect(s.getTicket(tk.id)!.status).toBe('running');
  });

  it('success with pr_url → review', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    s.updateTicket(tk.id, { pr_url: 'https://github.com/o/r/pull/1' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.status).toBe('review');
  });

  it('success without pr_url → done', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.status).toBe('done');
  });

  it('error → failed; cancelled → open', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const a = s.createTicket({ title: 'a', projectPath: '/p' });
    const b = s.createTicket({ title: 'b', projectPath: '/p' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: a.id, status: 'errored', result: 'error' });
    mgr.emit('task', { id: 'r2', source_kind: 'ticket', source_id: b.id, status: 'idle', result: 'cancelled' });
    expect(s.getTicket(a.id)!.status).toBe('failed');
    expect(s.getTicket(b.id)!.status).toBe('open');
  });

  it('ignores non-ticket frames and merged/closed tickets', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    s.updateTicket(tk.id, { status: 'merged' });
    mgr.emit('task', { id: 'r1', source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.status).toBe('merged'); // not overwritten
    mgr.emit('task', { id: 'r2', source_kind: 'cron', source_id: 'c1', status: 'idle', result: 'success' }); // no throw
  });

  it('fallback: scans events for a PR URL when link_pr was not called', () => {
    const s = new Store(':memory:'); const mgr = wire(s);
    const tk = s.createTicket({ title: 't', projectPath: '/p' });
    const run = s.createTask({ projectPath: '/p', prompt: 'go', origin: 'ticket', sourceKind: 'ticket', sourceId: tk.id });
    s.appendEvent(run.id, { sdkUuid: null, type: 'assistant', payload: { text: 'opened https://github.com/o/r/pull/99 done' } });
    mgr.emit('task', { id: run.id, source_kind: 'ticket', source_id: tk.id, status: 'idle', result: 'success' });
    expect(s.getTicket(tk.id)!.pr_url).toBe('https://github.com/o/r/pull/99');
    expect(s.getTicket(tk.id)!.status).toBe('review'); // fallback ran before the review/done decision
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && pnpm vitest run test/ticketLoop.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the listener**

Create `server/src/ticketAutomation.ts`:

```ts
import type { Store } from './store.ts';
import type { SessionManager } from './sessionManager.ts';

interface TaskFrame {
  id: string;
  source_kind: string | null;
  source_id: string | null;
  status: 'active' | 'idle' | 'errored';
  result: string | null;
}

const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
const HUMAN_TERMINAL = new Set(['merged', 'closed']);

/** Drive ticket status from task lifecycle frames. Decoupled from SessionManager. */
export function registerTicketAutomation(manager: SessionManager, store: Store): void {
  manager.on('task', (frame: TaskFrame) => {
    try {
      if (frame.source_kind !== 'ticket' || !frame.source_id) return;
      const tk = store.getTicket(frame.source_id);
      if (!tk || HUMAN_TERMINAL.has(tk.status)) return;

      if (frame.status === 'active') {
        store.updateTicket(tk.id, { status: 'running' });
        return;
      }
      // terminal frame
      if (frame.result === 'success') {
        // PR fallback: if the agent opened a PR but didn't call link_pr, scan its events.
        let prUrl = tk.pr_url;
        if (!prUrl) {
          for (const e of store.eventsSince(frame.id, 0)) {
            const m = PR_URL.exec(typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload ?? ''));
            if (m) { prUrl = m[0]; store.updateTicket(tk.id, { pr_url: prUrl }); break; }
          }
        }
        store.updateTicket(tk.id, { status: prUrl ? 'review' : 'done' });
      } else if (frame.result === 'error' || frame.result === 'queue_full') {
        store.updateTicket(tk.id, { status: 'failed' });
      } else if (frame.result === 'cancelled') {
        store.updateTicket(tk.id, { status: 'open' });
      }
    } catch (err) {
      console.error('[ticketAutomation] frame handling failed:', err instanceof Error ? err.message : err);
    }
  });
}
```

> Check `store.eventsSince`'s returned `payload` type: if the store already JSON-parses payloads, the `typeof === 'string'` branch handles both; the `JSON.stringify` covers objects. Confirm `EventRow.payload` shape when implementing and keep the scan robust to both.

- [ ] **Step 4: Run — expect PASS**

Run: `cd server && pnpm vitest run test/ticketLoop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/ticketAutomation.ts server/test/ticketLoop.test.ts
git commit -m "feat(server): ticket state machine driven by run outcomes + PR fallback"
```

---

## Task 4: Wire the listener in server.ts

**Files:** Modify `server/src/server.ts`.

- [ ] **Step 1: Register**

Add the import and registration after the manager is constructed (after line 23):

```ts
import { registerTicketAutomation } from './ticketAutomation.ts';
// ...
const manager = new SessionManager(store, config);
registerTicketAutomation(manager, store);
```

- [ ] **Step 2: Typecheck + full suite**

Run: `cd server && pnpm exec tsc --noEmit && pnpm test`
Expected: 0 type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/server.ts
git commit -m "feat(server): wire ticketAutomation listener"
```

---

## Task 5: Augment the ticket run prompt (route test)

**Files:** Modify `server/src/routes.ts`; add a route test (to `ticketLoop.test.ts` or the existing routes test — match its harness).

- [ ] **Step 1: Edit the prompt**

In `POST /api/tickets/:id/run`, change the prompt construction to append the PR workflow:

```ts
    const prompt = `Work on this ticket.\n\nTitle: ${tk.title}\n\n${tk.body ?? ''}\n\nWork on a new git branch. When the change is complete, open a Pull Request with the \`gh\` CLI and then call the \`link_pr\` tool with the PR URL. If you cannot complete it, stop and explain why.`.trim();
```

- [ ] **Step 2: Route test (mirror routes.phase2.test.ts harness)**

Add a test that builds the app with a `:memory:` store + a fake `taskRunner` capturing the prompt, POSTs `/api/tickets/:id/run`, and asserts the captured prompt contains `link_pr` and `Pull Request`. (Read `server/test/routes.phase2.test.ts` for the exact app-build + `app.inject` + auth `login()` pattern; the fake manager/runner pattern there captures `run` args.)

- [ ] **Step 3: Run + typecheck**

Run: `cd server && pnpm vitest run test/ticketLoop.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes.ts server/test/ticketLoop.test.ts
git commit -m "feat(server): ticket run prompt instructs branch+PR+link_pr"
```

---

## Task 6: Frontend — statuses + merged/close buttons (TDD on the pure part)

**Files:** Modify `web/src/lib/automation.ts`, `web/src/lib/automation.test.ts`, `web/src/components/deck/ticket-detail.tsx`.

- [ ] **Step 1: Extend the automation test**

Append to `web/src/lib/automation.test.ts`:

```ts
import { statusChipClass, statusDotClass } from "./automation";

describe("merged/closed statuses", () => {
  it("normalizes merged and closed", () => {
    expect(normalizeTicketStatus("merged")).toBe("merged");
    expect(normalizeTicketStatus("closed")).toBe("closed");
  });
  it("TICKET_TABS includes merged and closed", () => {
    expect(TICKET_TABS).toContain("merged");
    expect(TICKET_TABS).toContain("closed");
  });
  it("has chip + dot classes for the new statuses (no undefined)", () => {
    expect(statusChipClass("merged")).toBeTruthy();
    expect(statusDotClass("closed")).toBeTruthy();
  });
});
```

(Ensure `normalizeTicketStatus`, `TICKET_TABS` are imported in the test file — they already are from the earlier suite; add `statusChipClass`/`statusDotClass` to the import.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd web && pnpm vitest run src/lib/automation.test.ts`
Expected: FAIL (merged/closed not in union/tabs).

- [ ] **Step 3: Implement**

In `web/src/lib/automation.ts`:

```ts
export type AutomationStatus = "open" | "running" | "review" | "done" | "failed" | "merged" | "closed";

const KNOWN: AutomationStatus[] = ["open", "running", "review", "done", "failed", "merged", "closed"];
```

Add cases to BOTH switches (they have no `default`, so every member needs a case):

```ts
// statusDotClass:
    case "merged":
      return "bg-primary";
    case "closed":
      return "border border-muted-foreground bg-transparent";

// statusChipClass:
    case "merged":
      return "bg-primary/15 text-primary";
    case "closed":
      return "bg-muted text-muted-foreground";
```

Add to `TICKET_TABS`:

```ts
export const TICKET_TABS = ["all", "open", "running", "review", "done", "failed", "merged", "closed"] as const;
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd web && pnpm vitest run src/lib/automation.test.ts`
Expected: PASS.

- [ ] **Step 5: Merged/Close buttons in ticket detail**

In `web/src/components/deck/ticket-detail.tsx`, import `useUpdateTicket` (from `@/hooks/use-automation-data`) and `normalizeTicketStatus`. When the normalized status is `review`, render two buttons in the footer beside Run:

```tsx
{status === "review" && (
  <>
    <Button className="flex-1" variant="ghost" onClick={() => update.mutate({ id: ticket.id, patch: { status: "closed" } })}>Close</Button>
    <Button className="flex-1" onClick={() => update.mutate({ id: ticket.id, patch: { status: "merged" } })}>Mark merged</Button>
  </>
)}
```

where `const update = useUpdateTicket();` and `status` is the already-computed `normalizeTicketStatus(ticket.status)` in that component. (Read the file first; `useUpdateTicket` mutationFn signature is `{id, patch}` per the hooks file.)

- [ ] **Step 6: Build + typecheck + tests**

Run: `cd web && pnpm build && pnpm exec tsc --noEmit --incremental false && pnpm test`
Expected: build clean, 0 type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/automation.ts web/src/lib/automation.test.ts web/src/components/deck/ticket-detail.tsx
git commit -m "feat(web): merged/closed ticket statuses + review actions"
```

---

## Task 7: Full verification

- [ ] **Step 1: Backend**

Run: `cd server && pnpm test && pnpm exec tsc --noEmit`
Expected: all pass, 0 errors.

- [ ] **Step 2: Frontend**

Run: `cd web && pnpm test && pnpm build && pnpm exec tsc --noEmit --incremental false`
Expected: all pass, build clean, 0 errors.

- [ ] **Step 3: Manual smoke (`proc-compose up`)**

1. Create a ticket → Run. Confirm the run prompt makes the agent branch + open a PR; the agent calls `link_pr` (or the fallback scan catches the URL).
2. Ticket flips `running → review`, PR chip appears, a toast fires.
3. Click **Mark merged** → status `merged`. Create another ticket whose run errors → `failed`.

- [ ] **Step 4: Final commit (if cleanup)**

```bash
git add -A && git commit -m "chore: ticket-PR-loop verification pass"
```

---

## Self-Review (completed)

- **Spec coverage:** state machine (T3/T4), `link_pr` tool + scoping (T1), ticketId wiring (T2), PR fallback scan (T3), prompt augmentation (T5), frontend statuses + review actions (T6). All covered.
- **Placeholder scan:** none. The two judgment calls (SDK tool-list introspection shape in T1; `eventsSince` payload type in T3) carry explicit verify-and-adapt notes rather than guesses.
- **Type consistency:** `link_pr`/`linkPrHandler(store, ticketId, {url})`, `buildDeckMcp(store, projectPath, ticketId?)`, `TaskFrame` shape, transition results (`success/error/queue_full/cancelled`), and `AutomationStatus` (now incl. `merged`/`closed`) are consistent across backend and frontend. `useUpdateTicket({id, patch})` matches the hooks file.
- **Exhaustiveness:** widening `AutomationStatus` requires new cases in both `statusDotClass`/`statusChipClass` (no `default`) — included, so tsc stays green.
- **Safety:** no auto-merge; `merged`/`closed` only via human PATCH; listener guards human-terminal states + try/catch per frame.
```

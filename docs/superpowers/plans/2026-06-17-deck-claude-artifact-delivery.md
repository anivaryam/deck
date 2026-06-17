# Claude → User Artifact Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude deliver images (inline), PDFs (inline preview + download), and other files (download link) to the user through the deck chat UI by writing files into the project and referencing them with markdown.

**Architecture:** A new authenticated, path-jailed `GET /api/file/:sessionId/*` route streams files from the session's `project_path`. A pure tokenizer parses markdown image/link tokens out of assistant message text; the assistant message renderer turns them into `<img>`, a PDF preview block, or a download chip, rewriting relative paths to the file route. No schema, transport, or `adapt.ts` change.

**Tech Stack:** Fastify + TypeScript (server), React + Vite + TypeScript (web), Vitest (both).

---

## File Structure

- `server/src/routes.ts` (modify) — add the `GET /api/file/:sessionId/*` route inline, mirroring the existing upload route's session lookup + path jail.
- `server/test/fileServe.test.ts` (create) — route tests, mirroring `server/test/upload.test.ts` harness.
- `web/src/lib/artifacts.ts` (create) — pure tokenizer + URL resolver (`parseArtifacts`, `resolveSrc`, `isImagePath`, `isPdfPath`).
- `web/src/lib/artifacts.test.ts` (create) — pure-function unit tests.
- `web/src/components/deck/message-list.tsx` (modify) — new `ArtifactContent` + `PdfBlock` components; render them for the `claude` role; thread `sessionId`.
- `web/src/components/deck/deck-view.tsx` (modify, line 240) — pass `sessionId={activeThreadId}` to `MessageList`.
- `CLAUDE.md` (modify/create) + `.gitignore` (modify) — document the convention; ignore artifact dirs.

---

## Task 1: Server file-serve route

**Files:**
- Modify: `server/src/routes.ts` (add route inside `registerRoutes`, after the upload route ~line 213)
- Test: `server/test/fileServe.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/fileServe.test.ts`:

```ts
// server/test/fileServe.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.ts';
import { TaskRunner } from '../src/taskRunner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { registerRoutes } from '../src/routes.ts';

const TOKEN = 'file-serve-token-9999';

let root: string;
let app: ReturnType<typeof Fastify>;
let store: Store;
let projectPath: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-fileserve-'));
  projectPath = path.join(root, 'alpha');
  fs.mkdirSync(path.join(projectPath, '.deck-artifacts'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'report.pdf'), Buffer.from('%PDF-1.4 fake'));
  fs.writeFileSync(path.join(projectPath, '.deck-artifacts', 'data.zip'), Buffer.from('PK fake'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET'); // outside the project

  store = new Store(':memory:');
  const fakeManager = { send: async () => {} } as any;
  const taskRunner = new TaskRunner(store, fakeManager);
  const scheduler = new Scheduler(store, taskRunner);

  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, {
    store,
    config: { token: TOKEN, projectsRoot: root, port: 1, model: 'claude-opus-4-8' },
    taskRunner,
    scheduler,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth', payload: { token: TOKEN } });
  return res.headers['set-cookie'] as string;
}

describe('GET /api/file/:sessionId/*', () => {
  it('returns 401 without a cookie', async () => {
    const sess = store.create({ projectPath });
    const res = await app.inject({ method: 'GET', url: `/api/file/${sess.id}/.deck-artifacts/shot.png` });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown session', async () => {
    const cookieHeader = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/file/no-such-session/.deck-artifacts/shot.png',
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(404);
  });

  it('serves an image inline with the right Content-Type', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/shot.png`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(String(res.headers['content-disposition'])).toContain('inline');
    expect(res.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('serves a pdf inline', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/report.pdf`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(String(res.headers['content-disposition'])).toContain('inline');
  });

  it('serves an unknown type as an attachment download', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/data.zip`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
  });

  it('blocks path traversal out of the project (403)', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/../secret.txt`,
      headers: { cookie: cookieHeader },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.rawPayload.toString()).not.toContain('TOP SECRET');
  });

  it('blocks a symlink that escapes the project (403/404)', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(projectPath, '.deck-artifacts', 'escape.txt'));
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/escape.txt`,
      headers: { cookie: cookieHeader },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.rawPayload.toString()).not.toContain('TOP SECRET');
  });

  it('returns 404 for a missing file', async () => {
    const cookieHeader = await login();
    const sess = store.create({ projectPath });
    const res = await app.inject({
      method: 'GET',
      url: `/api/file/${sess.id}/.deck-artifacts/nope.png`,
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/fileServe.test.ts`
Expected: FAIL — most cases return 404 (route not registered) so e.g. the image/pdf/zip/disposition assertions fail.

- [ ] **Step 3: Write the route**

In `server/src/routes.ts`, add these module-level constants just above `export function registerRoutes` (after the imports, near line 30):

```ts
const FILE_CT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
// SVG/HTML are intentionally NOT inlined (stored XSS via same-origin markup).
const INLINE_CT = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const MAX_SERVE = 50 * 1024 * 1024;
```

Then inside `registerRoutes`, after the `/api/upload` route (after line 213), add:

```ts
  app.get<{ Params: { sessionId: string; '*': string } }>('/api/file/:sessionId/*', async (req, reply) => {
    const sess = store.get(req.params.sessionId);
    if (!sess) return reply.code(404).send({ error: 'unknown session' });

    const rel = req.params['*'];
    if (!rel) return reply.code(400).send({ error: 'path required' });

    const root = path.resolve(sess.project_path);
    const dest = path.resolve(root, rel);
    // Jail: resolved path must stay strictly under the project root.
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    let realRoot: string;
    let realDest: string;
    let stat: fs.Stats;
    try {
      realRoot = fs.realpathSync(root);
      realDest = fs.realpathSync(dest);
      stat = fs.statSync(realDest);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
    // Symlink guard: the real (link-resolved) path must also stay under the real root.
    if (realDest !== realRoot && !realDest.startsWith(realRoot + path.sep)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!stat.isFile()) return reply.code(404).send({ error: 'not found' });
    if (stat.size > MAX_SERVE) return reply.code(413).send({ error: 'file too large (max 50MB)' });

    const ext = path.extname(realDest).toLowerCase();
    const ct = FILE_CT[ext] ?? 'application/octet-stream';
    const disposition = INLINE_CT.has(ct) ? 'inline' : 'attachment';
    const safeName = path.basename(realDest).replace(/["\r\n]/g, '');
    reply.header('Content-Type', ct);
    reply.header('Content-Disposition', `${disposition}; filename="${safeName}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(realDest));
  });
```

Note: `fs` and `path` are already imported at the top of `routes.ts` (lines 2-3). The `/api/*` preHandler (lines 64-66) already enforces the session cookie, so the 401-without-cookie case is handled with no extra code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run test/fileServe.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the full server suite (no regressions)**

Run: `cd server && npm test`
Expected: PASS (all existing suites + the new one).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes.ts server/test/fileServe.test.ts
git commit -m "feat(server): add jailed /api/file route for serving project artifacts"
```

---

## Task 2: Frontend artifact tokenizer (pure functions)

**Files:**
- Create: `web/src/lib/artifacts.ts`
- Test: `web/src/lib/artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/artifacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArtifacts, resolveSrc, isImagePath, isPdfPath } from './artifacts';

describe('parseArtifacts', () => {
  it('returns a single text segment for plain prose', () => {
    expect(parseArtifacts('hello world')).toEqual([{ kind: 'text', value: 'hello world' }]);
  });

  it('parses a markdown image', () => {
    expect(parseArtifacts('![a shot](.deck-artifacts/shot.png)')).toEqual([
      { kind: 'image', alt: 'a shot', src: '.deck-artifacts/shot.png' },
    ]);
  });

  it('keeps surrounding text and preserves order', () => {
    expect(parseArtifacts('see ![](x.png) here')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'image', alt: '', src: 'x.png' },
      { kind: 'text', value: ' here' },
    ]);
  });

  it('parses a markdown link as a link segment', () => {
    expect(parseArtifacts('[report.pdf](.deck-artifacts/report.pdf)')).toEqual([
      { kind: 'link', label: 'report.pdf', href: '.deck-artifacts/report.pdf' },
    ]);
  });

  it('handles multiple tokens', () => {
    const segs = parseArtifacts('![](a.png) and [b](b.zip)');
    expect(segs.map((s) => s.kind)).toEqual(['image', 'text', 'link']);
  });
});

describe('resolveSrc', () => {
  it('rewrites a relative path to the file route', () => {
    expect(resolveSrc('.deck-artifacts/shot.png', 'sid1')).toBe('/api/file/sid1/.deck-artifacts/shot.png');
  });
  it('strips a leading ./', () => {
    expect(resolveSrc('./x.png', 'sid1')).toBe('/api/file/sid1/x.png');
  });
  it('encodes path segments', () => {
    expect(resolveSrc('dir name/a b.png', 'sid1')).toBe('/api/file/sid1/dir%20name/a%20b.png');
  });
  it('passes http(s) URLs through unchanged', () => {
    expect(resolveSrc('https://example.com/x.png', 'sid1')).toBe('https://example.com/x.png');
  });
  it('passes data URLs through unchanged', () => {
    expect(resolveSrc('data:image/png;base64,AAAA', 'sid1')).toBe('data:image/png;base64,AAAA');
  });
});

describe('type predicates', () => {
  it('detects image extensions', () => {
    expect(isImagePath('a.PNG')).toBe(true);
    expect(isImagePath('a.jpeg')).toBe(true);
    expect(isImagePath('a.pdf')).toBe(false);
  });
  it('detects pdf', () => {
    expect(isPdfPath('a.PDF')).toBe(true);
    expect(isPdfPath('a.png')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/artifacts.test.ts`
Expected: FAIL with "Failed to resolve import './artifacts'" / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/artifacts.ts`:

```ts
export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'link'; href: string; label: string };

// Group 1/2 = image alt/src (![alt](src)); group 3/4 = link label/href ([label](href)).
const TOKEN = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseArtifacts(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(content)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: content.slice(last, m.index) });
    if (m[2] !== undefined) {
      out.push({ kind: 'image', alt: m[1] ?? '', src: m[2] });
    } else {
      out.push({ kind: 'link', label: m[3] ?? '', href: m[4]! });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ kind: 'text', value: content.slice(last) });
  return out;
}

export function resolveSrc(src: string, sessionId: string): string {
  if (/^(https?:|data:)/i.test(src)) return src;
  const clean = src.replace(/^\.?\//, '');
  const enc = clean.split('/').map(encodeURIComponent).join('/');
  return `/api/file/${encodeURIComponent(sessionId)}/${enc}`;
}

export function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(p.split('?')[0]);
}

export function isPdfPath(p: string): boolean {
  return /\.pdf$/i.test(p.split('?')[0]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/artifacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/artifacts.ts web/src/lib/artifacts.test.ts
git commit -m "feat(web): add artifact markdown tokenizer + URL resolver"
```

---

## Task 3: Render artifacts in assistant messages + thread sessionId

**Files:**
- Modify: `web/src/components/deck/message-list.tsx`
- Modify: `web/src/components/deck/deck-view.tsx:240`

- [ ] **Step 1: Add the artifact components and update imports**

In `web/src/components/deck/message-list.tsx`, change the imports at the top (lines 1-4) to add the tokenizer + `ExternalLink` icon:

```tsx
import { ChevronRight, ExternalLink, FileText, Loader2, Paperclip } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Message, ToolCall } from "@/lib/types";
import { parseArtifacts, isPdfPath, resolveSrc } from "@/lib/artifacts";
```

Then add these two components just above `function ToolBlock` (before line 95):

```tsx
function PdfBlock({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="my-1.5 block">
      <span className="flex items-center gap-2">
        <a
          href={url}
          download
          className="inline-flex items-center gap-1.5 rounded border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-3" />
          {label}
        </a>
        <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-primary/80 hover:text-primary">
          {open ? "hide preview" : "preview"}
        </button>
      </span>
      {open && (
        <iframe src={url} title={label} className="mt-1 h-96 w-full rounded-md border border-border bg-white" />
      )}
    </span>
  );
}

function ArtifactContent({
  content,
  sessionId,
  streaming,
}: {
  content: string;
  sessionId?: string | null;
  streaming?: boolean;
}) {
  const caret = streaming ? (
    <span className="caret-blink ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-primary" />
  ) : null;

  // Without a session id we cannot build file URLs — fall back to plain text.
  if (!sessionId) {
    return (
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {content}
        {caret}
      </div>
    );
  }

  const segments = parseArtifacts(content);
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {segments.map((s, i) => {
        if (s.kind === "text") return <span key={i}>{s.value}</span>;
        if (s.kind === "image") {
          const url = resolveSrc(s.src, sessionId);
          return (
            <a key={i} href={url} target="_blank" rel="noreferrer" className="my-1.5 block w-fit">
              <img
                src={url}
                alt={s.alt}
                loading="lazy"
                className="max-h-80 rounded-md border border-border"
              />
            </a>
          );
        }
        const url = resolveSrc(s.href, sessionId);
        if (isPdfPath(s.href)) {
          return <PdfBlock key={i} url={url} label={s.label || "document.pdf"} />;
        }
        return (
          <a
            key={i}
            href={url}
            download
            className="inline-flex items-center gap-1.5 rounded border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            {s.label || "download"}
          </a>
        );
      })}
      {caret}
    </div>
  );
}
```

- [ ] **Step 2: Use the renderer for the claude role and thread sessionId**

In the same file, change the `MessageList` signature (line 12) and the map (lines 20-24):

```tsx
export function MessageList({ messages, sessionId }: { messages: Message[]; sessionId?: string | null }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="mb-6 border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
        <div className="text-primary">claude-deck v0.1.0</div>
        <div>session started · type / for commands · ^C to exit</div>
      </div>

      <ul className="space-y-5">
        {messages.map((m) => (
          <MessageBlock key={m.id} m={m} sessionId={sessionId} />
        ))}
      </ul>
    </div>
  );
}
```

Change the `MessageBlock` signature (line 29):

```tsx
const MessageBlock = memo(function MessageBlock({ m, sessionId }: { m: Message; sessionId?: string | null }) {
```

Replace the content block (current lines 65-72) with a role-gated render — `claude` gets artifacts, everyone else stays plain text:

```tsx
          {m.content &&
            (m.role === "claude" ? (
              <ArtifactContent content={m.content} sessionId={sessionId} streaming={m.streaming} />
            ) : (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {m.content}
                {m.streaming && (
                  <span className="caret-blink ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-primary" />
                )}
              </div>
            ))}
```

- [ ] **Step 3: Pass sessionId from deck-view**

In `web/src/components/deck/deck-view.tsx`, line 240, change:

```tsx
<MessageList messages={view} />
```

to:

```tsx
<MessageList messages={view} sessionId={activeThreadId} />
```

(`activeThreadId` is already in scope — it is passed to `Composer` as `sessionId={activeThreadId}` at line 260.)

- [ ] **Step 4: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 5: Run the web test suite (no regressions)**

Run: `cd web && npm test`
Expected: PASS (artifacts tests still green; nothing else broken).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/deck/message-list.tsx web/src/components/deck/deck-view.tsx
git commit -m "feat(web): render image/pdf/file artifacts in assistant messages"
```

---

## Task 4: Document the convention for Claude

**Files:**
- Modify (or create): `CLAUDE.md` at the repo root
- Modify: `.gitignore`

- [ ] **Step 1: Add the artifact convention to CLAUDE.md**

Append this section to the repo-root `CLAUDE.md` (create the file with just this section if it does not exist):

```markdown
## Delivering artifacts to the user (images, PDFs, files)

The deck chat UI renders markdown image and link tokens in your replies and serves
files from this project over `GET /api/file/:sessionId/*` (jailed to the project dir).

- **Show an image / screenshot:** write the file into the repo, then reference it:
  `![caption](.deck-artifacts/screenshot.png)` — it renders inline (click = full size).
  Supported inline image types: png, jpg/jpeg, webp, gif.
- **Share a PDF:** `[report.pdf](.deck-artifacts/report.pdf)` — renders a download chip
  with an inline "preview" toggle.
- **Share any other file:** `[bundle.zip](.deck-artifacts/bundle.zip)` — renders a
  download chip.
- Prefer writing artifacts under `.deck-artifacts/` to keep them out of the working tree.
  Any path inside the project works; paths outside the project are refused (403).
- Screenshots: capture with your normal tooling (Bash, Playwright, etc.), save the image
  into `.deck-artifacts/`, then reference it with the markdown image syntax above.
```

- [ ] **Step 2: Ignore the artifact directories**

Add to `.gitignore` (append if the lines are not already present):

```
.deck-artifacts/
.deck-uploads/
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .gitignore
git commit -m "docs: document Claude artifact-delivery convention"
```

---

## Task 5: End-to-end manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Run: `proc-compose up` (from the repo root), then open the deck web UI and log in.

- [ ] **Step 2: Have Claude deliver an image**

In a chat session, ask Claude to create an image and show it, e.g.:
"Write a small PNG to `.deck-artifacts/test.png` and show it to me."
Expected: an inline image appears in Claude's reply; clicking it opens full size in a new tab.

- [ ] **Step 3: Have Claude deliver a PDF and a file**

Ask Claude to reference a PDF and a non-image file with markdown links.
Expected: a download chip with a working "preview" iframe for the PDF; a download chip for the other file.

- [ ] **Step 4: Confirm the security jail**

In the browser, manually request `GET /api/file/<sessionId>/../../etc/passwd` (logged in).
Expected: 403 (or 404), no file contents.

- [ ] **Step 5: Final commit (if any doc tweaks were needed)**

```bash
git add -A
git commit -m "chore: artifact delivery e2e verification notes" || echo "nothing to commit"
```

---

## Notes for the implementer

- Run server tests from `server/`, web tests from `web/` — each has its own `vitest`.
- The `/api/file` route needs no auth code of its own; the existing `/api/*` preHandler
  (`server/src/routes.ts:64-66`) gates it on the session cookie. The `sessionId` in the
  URL only selects the project root — it is not a credential.
- SVG and HTML are deliberately served as `attachment`, never inlined, to avoid stored
  XSS through same-origin markup. Do not add them to `INLINE_CT`.
- The tokenizer only recognizes `![alt](src)` and `[label](href)`. It is not a full
  markdown parser — headings, lists, bold, and code fences are intentionally left as
  literal text so existing plain-text formatting is unchanged.
```

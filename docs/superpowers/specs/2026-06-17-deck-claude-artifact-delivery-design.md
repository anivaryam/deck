# Claude → User Artifact Delivery in Deck Chat

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Problem

Claude can `Write` files to disk (screenshots, PDFs, generated assets) inside the
session's project, but the deck chat UI renders assistant messages as **plain text
only**. The user cannot see or download anything Claude produces. Goal: let Claude
deliver visual artifacts — screenshots/PNGs inline, PDFs inline, other files as
download links — so the user can *see how it looks*.

### Current state (evidence)

- `web/src/components/deck/message-list.tsx:65-72` — assistant `content` rendered as
  raw text in a `whitespace-pre-wrap` div. No markdown, no `<img>`.
- `web/src/lib/adapt.ts` — keeps only `text` + `tool_use` blocks; image content blocks
  dropped. (Unchanged by this design — markdown rides inside the `text`.)
- `server/src/server.ts:41-51` — static serving registered for the built SPA only.
  No route serves project files / `.deck-uploads/`.
- `server/src/routes.ts:64-74` — `/api/*` preHandler requires a valid session cookie;
  GET/HEAD/OPTIONS skip the cross-origin check. A new `/api/file/...` GET inherits this
  auth gate automatically.
- `server/src/routes.ts:190-213` — existing upload route resolves `store.get(sessionId)`
  → `sess.project_path` and jails writes under `.deck-uploads/`. The serve route mirrors
  this resolution + jail pattern in reverse (read instead of write).

## Scope

In:
- Inline render of images (`png/jpg/jpeg/webp/gif`) in assistant messages.
- Inline render of PDFs (collapsible embed) + download link.
- Download link/chip for any other referenced file.
- A new authenticated file-serve route scoped to the session's project dir.

Out (YAGNI):
- No change to message schema / WS transport / `adapt.ts`.
- No full-markdown rendering (no headings/lists/tables). Only images + links are parsed.
- No render of artifacts in **user** messages (assistant branch only).
- No thumbnailing, no preview for text/csv/svg/html beyond a download link.
- No new dependency (no `react-markdown`).

## Design

### Component 1 — File-serve route (`server/src/routes.ts`)

```
GET /api/file/:sessionId/*   → streams the file
```

Behavior:
1. `sess = store.get(req.params.sessionId)`; 404 if unknown.
2. `rel = req.params['*']` (the wildcard path). Reject empty.
3. `root = path.resolve(sess.project_path)`,
   `dest = path.resolve(root, rel)`.
4. **Jail:** reject (403) unless `dest === root` is false AND
   `dest.startsWith(root + path.sep)`. Mirrors the upload jail at
   `routes.ts:206-208`.
5. **Symlink escape guard:** `fs.realpathSync(dest)` must also stay under
   `fs.realpathSync(root) + sep`; else 403. (Blocks a symlink inside the repo that
   points outside it.)
6. 404 if not a regular file (`fs.statSync(dest).isFile()` false).
7. Content-Type by extension (small map: png/jpg/jpeg/gif/webp/pdf/svg/txt/csv/json/…,
   default `application/octet-stream`).
8. `Content-Disposition`: `inline` for image/* and application/pdf; `attachment` for
   everything else.
9. Stream with `fs.createReadStream` (no full-buffer read — PDFs may be large).

Auth: inherited from the `/api/*` preHandler (`routes.ts:64-66`) — valid session cookie
required. No extra check needed. The sessionId in the path is **not** the auth token;
it only selects which project root to serve from.

Limits: cap served size (e.g. reject 413 over 50MB) to avoid streaming pathological
files. Decide exact cap in plan.

### Component 2 — Assistant artifact renderer (`web/src/components/deck/message-list.tsx`)

New small module (e.g. `web/src/lib/markup.tsx` or inline helper): a tokenizer that
splits assistant `content` into an ordered list of segments:

- `text` — literal run, rendered as today (`whitespace-pre-wrap`).
- `image` — from `![alt](src)`.
- `link` — from `[label](src)`.

Regex-based single pass over the string (no parser dep). Markdown image syntax
(`!\[...\]\(...\)`) checked before link syntax. Anything not matching stays `text`.

`src` resolution (`resolveSrc(src, sessionId)`):
- `http://` / `https://` / `data:` → use as-is.
- otherwise treat as project-relative; strip a leading `./` or `/`, then
  `/api/file/${sessionId}/${encodedPath}` (encode each path segment).

Render per segment:
- `image` → `<img loading="lazy">` with `max-h` cap + rounded border; wrapped in `<a
  target="_blank">` to the same URL (click = full size).
- `link` ending `.pdf` → collapsible `<iframe>`/`<embed>` (lazy, default collapsed)
  + a download `<a>` chip showing the filename.
- other `link` → download `<a>` chip (Paperclip/FileText icon, like existing attachment
  chips at `message-list.tsx:51-63`).

Only the **assistant** content div (`message-list.tsx:65-72`) switches to this renderer.
The `isUser` branch keeps plain text. Streaming caret behavior preserved (append caret
to the final text segment, or after the rendered block while `m.streaming`).

### Component 3 — sessionId plumbing

`MessageList` needs the active session id to build URLs.
- `deck-view.tsx:240` → `<MessageList messages={view} sessionId={activeThreadId} />`
  (`activeThreadId` already in scope; it is passed to `Composer` at `deck-view.tsx:260`).
- `MessageList` forwards `sessionId` to each `MessageBlock`, which passes it to the
  renderer. Null/undefined sessionId → fall back to plain text (no broken URLs).

### Component 4 — Claude-side convention (docs only)

Document in deck's `CLAUDE.md` (project instructions) so Claude knows the pattern:
- To show an image: write it into the repo (e.g. `.deck-artifacts/<name>.png`) then put
  `![caption](.deck-artifacts/<name>.png)` in the reply.
- To share a file: `[report.pdf](.deck-artifacts/report.pdf)`.
- Screenshots: capture via existing tooling (Bash / Playwright) → save into the repo →
  reference with markdown.
- `.deck-artifacts/` (and `.deck-uploads/`) should be in the project's `.gitignore`.

No code enforces `.deck-artifacts/` specifically — the serve route allows any path under
`project_path`. The directory is a convention for tidiness.

## Data flow

```
Claude Write → file at <project>/.deck-artifacts/shot.png
  → assistant stream text contains "![](.deck-artifacts/shot.png)"
  → adapt.ts passes text through unchanged (rides inside `text` block)
  → MessageBlock renderer tokenizes → <img src="/api/file/<sid>/.deck-artifacts/shot.png">
  → browser GET (session cookie) → preHandler authorizes → route jails + streams
  → user sees the image inline; click → full size
```

## Error handling

- Unknown session / missing file → 404. Renderer shows the chip/`<img>`; a broken image
  shows the browser's native broken-image state. Acceptable v1; optional `onError`
  fallback to a "file not found" chip in the plan.
- Path escape (`../`, symlink) → 403, file not served.
- No sessionId in UI → segments render as plain text (graceful).
- Oversized file → 413.

## Security notes

- Serve route is read-only, auth-gated (session cookie), jailed to `project_path`,
  symlink-guarded. Same trust boundary as the existing upload route, which already
  exposes the project dir for writes.
- sessionId in the URL is a selector, not a credential — the cookie is the gate. Knowing
  a sessionId does not grant access without a valid session.
- Path segments URL-encoded to avoid `%2e%2e` style traversal slipping past the router;
  jail check runs on the decoded resolved path regardless.

## Testing

- Route unit tests: happy path (image, pdf, other → correct Content-Type + Disposition);
  traversal `../../etc/passwd` → 403; symlink-escape → 403; unknown session → 404;
  missing file → 404; oversize → 413; unauthenticated (no cookie) → 401.
- Renderer unit tests: `![](a.png)` → img with resolved URL; `[x](y.pdf)` → embed+link;
  `[x](z.zip)` → download chip; absolute `http` URL left as-is; plain text untouched;
  mixed text+image ordering preserved; no-sessionId → plain text.
- Manual: Claude writes a screenshot, references it, user sees it inline + can download a
  PDF.

## Blast radius

- 1 new route (`routes.ts`), no change to existing routes.
- 1 renderer swap in the assistant branch of `message-list.tsx` + 1 new small module.
- 1 prop threaded through `deck-view.tsx` → `MessageList` → `MessageBlock`.
- 1 doc note in `CLAUDE.md`, 1 `.gitignore` line.
- No schema, transport, `adapt.ts`, or `sessionManager.ts` change.
```

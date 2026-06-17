import { ChevronRight, ExternalLink, FileText, Loader2, Paperclip } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Message, ToolCall } from "@/lib/types";
import { parseArtifacts, isPdfPath, resolveSrc } from "@/lib/artifacts";

const ROLE_PREFIX: Record<string, { text: string; cls: string }> = {
  user: { text: "you@deck:~$", cls: "text-[color:var(--prompt-user)]" },
  claude: { text: "claude>", cls: "text-[color:var(--prompt-claude)]" },
  system: { text: "system:", cls: "text-muted-foreground" },
};

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

const MessageBlock = memo(function MessageBlock({ m, sessionId }: { m: Message; sessionId?: string | null }) {
  const prefix = ROLE_PREFIX[m.role];
  const isUser = m.role === "user";

  return (
    <li className={cn("cv-auto group flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%]", isUser ? "items-end" : "items-start")}>
        <div className={cn("text-[10px] font-medium tabular-nums", prefix.cls)}>
          {prefix.text}
        </div>

        <div
          className={cn(
            // The column wrapper aligns items-start/-end (not stretch), so the
            // bubble would size to its content's max-content and overflow. max-w-full
            // caps it to the column width; min-w-0 lets inner content wrap/scroll.
            "min-w-0 max-w-full rounded-lg border px-3 py-2",
            isUser
              ? "border-[color:var(--prompt-user)]/30 bg-[color:var(--prompt-user)]/10 text-foreground"
              : "border-border bg-card text-foreground",
          )}
        >
          {m.attachments && m.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {m.attachments.map((a) => (
                <span
                  key={a.name}
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Paperclip className="size-3" />
                  {a.name}
                </span>
              ))}
            </div>
          )}

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

          {m.code && (
            <pre className="scrollbar-thin mt-2 overflow-x-auto rounded-md border border-border bg-[oklch(0.12_0_0)] p-3 text-[12.5px] leading-relaxed">
              <div className="mb-1.5 flex items-center justify-between border-b border-border/60 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>{m.code.lang}</span>
                <span>↵ {m.code.value.split("\n").length} lines</span>
              </div>
              <code className="text-foreground">{m.code.value}</code>
            </pre>
          )}

          {m.tool && <ToolBlock t={m.tool} />}
        </div>

        <div className="px-1 text-[10px] text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100">
          {m.time}
        </div>
      </div>
    </li>
  );
});

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

function ToolBlock({ t }: { t: ToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-md border border-border bg-card/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        <ChevronRight
          className={cn("mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {/* min-w-0 + flex-wrap so a long tool name (e.g. mcp__server__very_long_tool)
            wraps/truncates instead of forcing the bubble wider. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="max-w-full truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
            {t.name}
          </span>
          <code className="min-w-0 flex-1 truncate text-muted-foreground">{t.input}</code>
        </div>
        {t.output && (
          <span className="mt-0.5 max-w-[6rem] shrink-0 truncate text-right text-[10px] text-primary/80">
            {t.output}
          </span>
        )}
      </button>
      {open && (
        <div className="min-w-0 border-t border-border px-2.5 py-2 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1.5">
            <FileText className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{t.input}</span>
          </div>
          {t.output && (
            <pre className="scrollbar-thin mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap break-words text-foreground/80">
              {t.outputFull || t.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ThinkingIndicator() {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2 sm:px-6">
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin text-primary" />
        thinking…
      </div>
    </div>
  );
}

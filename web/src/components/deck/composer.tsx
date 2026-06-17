import { ArrowUp, AtSign, Mic, Paperclip, SlashSquare, Square, X } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SLASH_COMMANDS } from "@/lib/static-data";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ImageAttachment } from "@/lib/types";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

type Props = {
  onSend: (text: string, images: ImageAttachment[]) => void;
  onCancel?: () => void;
  busy: boolean;
  connected: boolean;
  sessionId?: string;
};

// Strip the `data:<mt>;base64,` prefix; capture media_type from the blob.
function readImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({ media_type: file.type, data: comma >= 0 ? result.slice(comma + 1) : result, name: file.name });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function Composer({ onSend, onCancel, busy, connected, sessionId }: Props) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-grow with the content: collapse to measure, then snap to scrollHeight.
  // CSS max-height caps it; past the cap the textarea scrolls internally.
  // Runs on every `value` change, so slash-command inserts and clearing on
  // submit also resize correctly.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  async function addFiles(picked: File[]) {
    setError(null);
    const imageFiles = picked.filter((f) => f.type.startsWith("image/"));
    const otherFiles = picked.filter((f) => !f.type.startsWith("image/"));

    // Images: enforce the count/size caps BEFORE reading (don't decode work we'll
    // discard), and surface errors outside the state updater (StrictMode-safe).
    const remaining = MAX_IMAGES - images.length;
    if (imageFiles.length > Math.max(0, remaining)) setError(`At most ${MAX_IMAGES} images per turn.`);
    const accepted: File[] = [];
    for (const f of imageFiles.slice(0, Math.max(0, remaining))) {
      if (f.size > MAX_IMAGE_BYTES) setError(`${f.name} is over 5MB.`);
      else accepted.push(f);
    }
    const results = await Promise.all(
      accepted.map((f) =>
        readImageAttachment(f).then(
          (a) => ({ ok: true as const, a }),
          () => ({ ok: false as const, name: f.name }),
        ),
      ),
    );
    const good: ImageAttachment[] = [];
    for (const r of results) {
      if (r.ok) good.push(r.a);
      else setError(`Could not read ${r.name}.`);
    }
    if (good.length) setImages((prev) => [...prev, ...good].slice(0, MAX_IMAGES));

    // Non-image files upload to the active session's project.
    for (const file of otherFiles) {
      if (!sessionId) {
        setError("Open or start a chat before uploading files.");
        continue;
      }
      try {
        const b64 = await readBase64(file);
        const { path } = await api.upload(sessionId, file.name, b64);
        setFiles((prev) => [...prev, path]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    await addFiles(picked);
  }

  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items).filter((it) => it.type.startsWith("image/"));
    if (!items.length) return;
    e.preventDefault();
    const picked = items.map((it) => it.getAsFile()).filter((f): f is File => f != null);
    await addFiles(picked);
  }

  async function onDrop(e: DragEvent) {
    if (busy) return;
    const dropped = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (!dropped.length) return;
    e.preventDefault();
    await addFiles(dropped);
  }

  function submit() {
    const v = value.trim();
    const hasAttachments = images.length > 0 || files.length > 0;
    if ((!v && !hasAttachments) || busy || !connected) return;
    const suffix = files.length ? `\n\nAttached files: ${files.join(", ")}` : "";
    onSend(v + suffix, images);
    setValue("");
    setImages([]);
    setFiles([]);
    setError(null);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const hasAttachments = images.length > 0 || files.length > 0;
  const canSend = connected && !busy && (value.trim().length > 0 || hasAttachments);

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => {
        if (!busy) e.preventDefault();
      }}
      className="border-t border-border bg-background px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pt-3"
    >
      <div className="mx-auto w-full max-w-3xl">
        {hasAttachments && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((img, i) => (
              <span
                key={`img-${i}`}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <Paperclip className="size-3" />
                {img.name || `image ${i + 1}`}
                <button
                  onClick={() => setImages((s) => s.filter((_, j) => j !== i))}
                  className="text-muted-foreground/60 hover:text-destructive"
                  aria-label="remove"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {files.map((path, i) => (
              <span
                key={`file-${i}`}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <Paperclip className="size-3" />
                {path}
                <button
                  onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}
                  className="text-muted-foreground/60 hover:text-destructive"
                  aria-label="remove"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <div className="mb-2 px-1 text-[11px] text-destructive">{error}</div>}

        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
          <span className="select-none pb-2 pl-1 text-sm font-medium text-primary">$</span>

          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            rows={1}
            placeholder={busy ? "agent working…" : connected ? "ask claude…" : "reconnecting…"}
            className="scrollbar-thin max-h-[40vh] min-h-[36px] w-full resize-none overflow-y-auto bg-transparent py-1.5 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 sm:max-h-56 sm:text-sm"
          />

          <div className="flex shrink-0 items-center gap-0.5">
            <input ref={fileInputRef} type="file" multiple onChange={onPick} className="hidden" />
            <IconBtn label="Attach" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="size-4" />
            </IconBtn>
            <IconBtn label="Mention context" className="hidden sm:inline-flex">
              <AtSign className="size-4" />
            </IconBtn>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 touch-manipulation text-muted-foreground hover:text-primary sm:size-8"
                  aria-label="Slash commands"
                >
                  <SlashSquare className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1rem))] p-1 font-mono">
                <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  slash commands
                </div>
                <ul className="max-h-80 overflow-y-auto">
                  {SLASH_COMMANDS.map((c) => (
                    <li key={c.cmd}>
                      <button
                        onClick={() => setValue((v) => (v ? v : "") + c.cmd + " ")}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded px-2 py-2 text-left text-xs hover:bg-accent"
                      >
                        <span className="text-primary">{c.cmd}</span>
                        <span className="truncate text-muted-foreground">{c.desc}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>

            <IconBtn label="Voice" className="hidden sm:inline-flex">
              <Mic className="size-4" />
            </IconBtn>

            {busy && onCancel ? (
              <Button
                size="icon"
                onClick={onCancel}
                aria-label="Stop"
                className="size-9 touch-manipulation rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:size-8"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={submit}
                disabled={!canSend}
                aria-label="Send"
                className="size-9 touch-manipulation rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 sm:size-8"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-1.5 hidden items-center justify-between px-1 text-[10px] text-muted-foreground/60 sm:flex">
          <span>type / for commands · paste an image to attach</span>
          <span>{connected ? "connected" : "reconnecting…"}</span>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  children,
  className,
  onClick,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          className={cn("size-9 touch-manipulation text-muted-foreground hover:text-primary sm:size-8", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

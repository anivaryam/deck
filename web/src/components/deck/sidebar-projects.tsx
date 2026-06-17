import { Link } from "@tanstack/react-router";
import { ChevronRight, Clock, FolderGit2, FolderPlus, ListChecks, MessageSquare, MessageSquarePlus, Plus, Search, TerminalSquare, Ticket as TicketIcon, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/lib/types";

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(ts).toLocaleDateString();
}

/** Mirror the server slug rule: a-z 0-9 - _, max 64, no leading/trailing separators. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
}

type Props = {
  projects: Project[];
  sessions: Session[];
  activeId?: string;
  activeProjectPath?: string;
  onNavigate?: () => void;
  onNewChat: (projectName: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteSession: (session: Session) => void | Promise<void>;
  // When rendered inside the mobile sheet, reserve room for the sheet's own
  // close (X) button so it doesn't overlap the header's action icons.
  reserveCloseButton?: boolean;
};

export function SidebarProjects({
  projects,
  sessions,
  activeId,
  activeProjectPath,
  onNavigate,
  onNewChat,
  onCreateProject,
  onDeleteSession,
  reserveCloseButton,
}: Props) {
  // Only the active (or last-open) project starts expanded; the rest collapse.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    activeProjectPath ? { [activeProjectPath]: true } : {},
  );
  // Chats sub-section open state per project. Auto-open the project that contains the active session.
  const [chatsOpen, setChatsOpen] = useState<Record<string, boolean>>(() => {
    if (!activeId) return {};
    const activeSession = sessions.find((s) => s.id === activeId);
    return activeSession ? { [activeSession.project_path]: true } : {};
  });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newProject, setNewProject] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Keep the current project expanded as you navigate; never collapse what the
  // user opened manually.
  useEffect(() => {
    if (activeProjectPath) setOpen((o) => (o[activeProjectPath] ? o : { ...o, [activeProjectPath]: true }));
  }, [activeProjectPath]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const q = query.trim().toLowerCase();

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* header */}
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-sidebar-border py-3 pl-3",
          reserveCloseButton ? "pr-12" : "pr-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <TerminalSquare className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold tracking-tight">claude-deck</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconBtn
            label="Search"
            onClick={() => {
              setSearchOpen((s) => {
                if (s) setQuery("");
                return !s;
              });
            }}
          >
            <Search className="size-4" />
          </IconBtn>

          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="New chat"
                    className="size-7 text-muted-foreground hover:text-primary"
                  >
                    <Plus className="size-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">New chat</TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              portal={false}
              className="flex max-h-[70vh] w-60 flex-col p-1 font-mono"
            >
              {/* Pinned at top so it's reachable no matter how many projects exist. */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const slug = slugify(newProject);
                  if (!slug) return;
                  setNewProject("");
                  setPickerOpen(false);
                  onCreateProject(slug);
                }}
                className="mb-1 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded border border-border px-2 py-1.5"
              >
                <FolderPlus className="size-3 shrink-0 text-primary/70" />
                <input
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  placeholder="new project… (enter)"
                  aria-label="New project name"
                  className="bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
                />
              </form>
              <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                new chat in…
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {projects.length === 0 && (
                  <li className="px-2 py-1.5 text-xs text-muted-foreground">no projects</li>
                )}
                {projects.map((p) => (
                  <li key={p.path}>
                    <button
                      onClick={() => {
                        setPickerOpen(false);
                        onNewChat(p.name);
                      }}
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <FolderGit2 className="size-3 shrink-0 text-primary/70" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* search */}
      {searchOpen && (
        <div className="border-b border-sidebar-border px-3 py-2">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2 py-1.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder="filter sessions…"
              className="bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-muted-foreground/60 hover:text-primary"
                aria-label="clear"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* projects */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {projects.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground">no projects found</div>
        )}
        {projects.map((p) => {
          const all = sessions.filter((t) => t.project_path === p.path);
          const projectMatches = !q || p.name.toLowerCase().includes(q);
          const threads = q && !projectMatches
            ? all.filter((t) => (t.title ?? "untitled session").toLowerCase().includes(q))
            : all;
          // While filtering, hide projects with no hits.
          if (q && !projectMatches && threads.length === 0) return null;
          // Filtering force-expands matches; otherwise honor the collapsed default.
          const isOpen = q ? true : (open[p.path] ?? false);
          return (
            <div key={p.path} className="mb-3">
              <button
                onClick={() => setOpen((s) => ({ ...s, [p.path]: !(s[p.path] ?? false) }))}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-left text-xs uppercase tracking-wider text-muted-foreground hover:bg-sidebar-accent"
              >
                <ChevronRight
                  className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")}
                />
                <span className="flex min-w-0 items-center gap-1.5">
                  <FolderGit2 className="size-3 shrink-0 text-primary/70" />
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="shrink-0 text-[10px] opacity-50">{all.length}</span>
              </button>

              {isOpen && (
                <>
                <div className="ml-4 border-l border-sidebar-border pl-2">
                  <Link
                    to="/tickets"
                    search={{ project: p.path }}
                    onClick={onNavigate}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
                  >
                    <TicketIcon className="size-3.5" /> Tickets
                  </Link>
                  <Link
                    to="/tasks"
                    search={{ project: p.path }}
                    onClick={onNavigate}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
                  >
                    <ListChecks className="size-3.5" /> Tasks
                  </Link>
                  <Link
                    to="/cron"
                    search={{ project: p.path }}
                    onClick={onNavigate}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground [&.active]:bg-sidebar-accent [&.active]:text-primary"
                  >
                    <Clock className="size-3.5" /> Cron
                  </Link>
                  <button
                    onClick={() => setChatsOpen((s) => ({ ...s, [p.path]: !(s[p.path] ?? false) }))}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <MessageSquare className="size-3.5 shrink-0" />
                    <span className="flex-1 text-left">Chats</span>
                    <span className="text-[10px] opacity-50">{threads.length}</span>
                    <ChevronRight
                      className={cn("size-3 shrink-0 transition-transform", (chatsOpen[p.path] ?? false) && "rotate-90")}
                    />
                  </button>
                  {(chatsOpen[p.path] ?? false) && (
                  <ul className="space-y-0.5 pt-1">
                  {threads.map((t) => {
                    const active = t.id === activeId;
                    return (
                      <li key={t.id} className="group/row relative">
                        <Link
                          to="/$threadId"
                          params={{ threadId: t.id }}
                          onClick={onNavigate}
                          className={cn(
                            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 pr-8 text-sm transition-colors",
                            active
                              ? "bg-sidebar-accent text-primary"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              active ? "bg-primary" : "bg-muted-foreground/30",
                            )}
                          />
                          <span className="truncate">{t.title || "untitled session"}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/60">
                            {relTime(t.created_at)}
                          </span>
                        </Link>
                        <DeleteSessionButton session={t} onDelete={onDeleteSession} />
                      </li>
                    );
                  })}
                  {!q && (
                    <li>
                      <button
                        onClick={() => onNewChat(p.name)}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground/60 hover:bg-sidebar-accent/60 hover:text-primary"
                      >
                        <MessageSquarePlus className="size-3.5 shrink-0" />
                        <span className="truncate text-left text-xs">new chat</span>
                      </button>
                    </li>
                  )}
                  </ul>
                  )}
                </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div className="border-t border-sidebar-border px-3 py-2.5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
            CD
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">deck@local</div>
            <div className="truncate text-[10px] text-muted-foreground">{sessions.length} sessions</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function IconBtn({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          className="size-7 text-muted-foreground hover:text-primary"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function DeleteSessionButton({
  session,
  onDelete,
}: {
  session: Session;
  onDelete: (session: Session) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Delete session"
          onClick={(e) => {
            // Only stop propagation — the button is a DOM sibling of the row's
            // <Link>, so it can't trigger navigation. Do NOT call preventDefault:
            // Radix's composeEventHandlers skips the trigger's open-toggle when the
            // child handler marks the event defaultPrevented, so the popover would
            // never open.
            e.stopPropagation();
          }}
          className={cn(
            "absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground/60",
            "opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-destructive",
            "group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" portal={false} className="w-48 p-2 font-mono">
        <p className="mb-2 px-1 text-xs text-foreground">Delete this session?</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              void onDelete(session);
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

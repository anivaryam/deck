import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarProjects } from "./sidebar-projects";
import { ChatHeader } from "./chat-header";
import { MessageList, ThinkingIndicator } from "./message-list";
import { Composer } from "./composer";
import { SettingsPanel } from "./settings-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProjects, useSessions } from "@/hooks/use-deck-data";
import { useSocket } from "@/lib/ws";
import { eventsToMessages } from "@/lib/adapt";
import { EFFORTS, MODELS } from "@/lib/static-data";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { EffortLevel, ImageAttachment, Model, Session } from "@/lib/types";

// A cold-start prompt (sent from "/") creates a session then navigates to
// "/$threadId", which remounts this component. The queued prompt is stashed at
// module scope so it survives the remount and flushes once the new socket opens.
let pendingOutbox: { id: string; text: string; images: ImageAttachment[] } | null = null;

function tildify(p: string): string {
  return p.replace(/^\/home\/[^/]+/, "~");
}

export function DeckView({ activeThreadId }: { activeThreadId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 768px)");

  const projectsQ = useProjects();
  const sessionsQ = useSessions();

  // Any /api 401 means the cookie is missing/expired → back to the login gate.
  // Branch on the typed status, not the message text.
  useEffect(() => {
    const err = (sessionsQ.error ?? projectsQ.error) as { status?: number } | null;
    if (err && err.status === 401) navigate({ to: "/login" });
  }, [sessionsQ.error, projectsQ.error, navigate]);

  const sessions = sessionsQ.data ?? [];
  const projects = projectsQ.data ?? [];
  const activeSession = activeThreadId ? sessions.find((s) => s.id === activeThreadId) : undefined;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState<Model>(MODELS[0]);
  const [effort, setEffort] = useState<EffortLevel>("high");

  const { messages: raw, busy, connected, sendPrompt, cancel } = useSocket(activeThreadId ?? null);
  const messages = useMemo(() => eventsToMessages(raw), [raw]);

  // streaming caret on the trailing assistant text while a turn is running
  const view = useMemo(() => {
    if (!busy || messages.length === 0) return messages;
    const last = messages[messages.length - 1];
    if (last.role === "claude" && last.content) {
      const copy = messages.slice();
      copy[copy.length - 1] = { ...last, streaming: true };
      return copy;
    }
    return messages;
  }, [messages, busy]);

  const lastMsg = view[view.length - 1];
  const thinking = busy && (!lastMsg || lastMsg.role === "user" || lastMsg.role === "system");

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  // Stick to the bottom only when the user is already near it; don't yank them
  // back down while they're scrolled up reading earlier output.
  const stickRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = atBottom;
    // Show the jump button only when scrolled up AND there's real content below.
    setShowJump(!atBottom && el.scrollHeight - el.clientHeight > 120);
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    // Instant, not smooth: conversations can be tens of thousands of px tall and
    // a smooth scroll over that distance feels sluggish and can undershoot.
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setShowJump(false);
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [view, thinking]);
  // Opening/switching a session should land at the latest message, not the top.
  useEffect(() => {
    stickRef.current = true;
    setShowJump(false);
  }, [activeThreadId]);

  // The server auto-titles a session from its first prompt. Refetch the list on
  // each turn boundary so the sidebar/header swap "untitled session" for the title.
  useEffect(() => {
    if (activeThreadId) qc.invalidateQueries({ queryKey: ["sessions"] });
  }, [busy, activeThreadId, qc]);

  // flush a queued cold-start prompt once its socket is live
  useEffect(() => {
    if (connected && activeThreadId && pendingOutbox?.id === activeThreadId) {
      const { text, images } = pendingOutbox;
      pendingOutbox = null;
      sendPrompt(
        text,
        images.map(({ media_type, data }) => ({ media_type, data })),
      );
    }
  }, [connected, activeThreadId, sendPrompt]);

  async function createAndOpen(
    projectName: string,
    firstPrompt?: { text: string; images: ImageAttachment[] },
  ) {
    let s;
    try {
      s = await api.createSession(projectName, { model: model.id, effort });
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        navigate({ to: "/login" });
        return;
      }
      toast.error(`Couldn't start session: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["sessions"] });
    if (firstPrompt) pendingOutbox = { id: s.id, text: firstPrompt.text, images: firstPrompt.images };
    navigate({ to: "/$threadId", params: { threadId: s.id } });
  }

  async function handleSend(text: string, images: ImageAttachment[]) {
    if (activeThreadId) {
      sendPrompt(
        text,
        images.map(({ media_type, data }) => ({ media_type, data })),
      );
      return;
    }
    const project = projects[0]?.name; // cold start defaults to the first project
    if (!project) {
      toast.error("No project available to start a chat.");
      return;
    }
    await createAndOpen(project, { text, images });
  }

  async function handleNewChat(projectName: string) {
    setSidebarOpen(false);
    await createAndOpen(projectName);
  }

  async function handleDeleteSession(session: Session) {
    try {
      await api.deleteSession(session.id);
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        navigate({ to: "/login" });
        return;
      }
      toast.error(`Couldn't delete session: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["sessions"] });
    if (session.id === activeThreadId) navigate({ to: "/" });
    toast.success("Session deleted");
  }

  async function handleCreateProject(name: string) {
    setSidebarOpen(false);
    try {
      await api.createProject(name);
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        navigate({ to: "/login" });
        return;
      }
      toast.error(`Couldn't create project: ${err instanceof Error ? err.message : "unknown error"}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["projects"] });
    await createAndOpen(name); // opens the first chat in the fresh project
  }

  const headerTitle = activeSession?.title || (activeThreadId ? "untitled session" : "new session");
  const headerProject = activeSession
    ? tildify(activeSession.project_path)
    : projects[0]
      ? tildify(projects[0].path)
      : undefined;
  const activeModelId = activeSession?.model ?? model.id;
  // Effort is locked at session creation (like model). Show the active session's
  // locked value when there is one; otherwise the pending choice for the next chat.
  const sessionEffort = (activeSession?.effort as EffortLevel | undefined) ?? undefined;

  // Per-session disabled tools (the settings-panel toggles). Parse defensively.
  const disabledTools = useMemo<string[]>(() => {
    const raw = activeSession?.disabled_tools;
    if (!raw) return [];
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a.filter((t): t is string => typeof t === "string") : [];
    } catch {
      return [];
    }
  }, [activeSession?.disabled_tools]);

  async function handleToolsChange(next: string[]) {
    if (!activeThreadId) return;
    // Optimistic: patch the cached session immediately so the switch flips with no lag.
    qc.setQueryData<Session[]>(["sessions"], (old) =>
      old?.map((s) => (s.id === activeThreadId ? { ...s, disabled_tools: JSON.stringify(next) } : s)),
    );
    try {
      await api.setSessionTools(activeThreadId, next);
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        navigate({ to: "/login" });
        return;
      }
      toast.error(`Couldn't update tools: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      qc.invalidateQueries({ queryKey: ["sessions"] });
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      /* best-effort: clear client state regardless */
    }
    qc.clear();
    navigate({ to: "/login" });
  }

  // The project to keep expanded by default: the active session's, or — with no
  // active session — the most recent session's ("last open project").
  const activeProjectPath = activeSession?.project_path ?? sessions[0]?.project_path;

  const renderSidebar = (inSheet: boolean) => (
    <SidebarProjects
      projects={projects}
      sessions={sessions}
      activeId={activeThreadId}
      activeProjectPath={activeProjectPath}
      onNewChat={handleNewChat}
      onCreateProject={handleCreateProject}
      onDeleteSession={handleDeleteSession}
      onNavigate={() => setSidebarOpen(false)}
      reserveCloseButton={inSheet}
    />
  );

  return (
    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
      <div
        className={cn(
          "grid h-full grid-rows-[minmax(0,1fr)]",
          isDesktop ? "grid-cols-[260px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        {/* sidebar */}
        {isDesktop ? (
          <div className="h-full border-r border-border">{renderSidebar(false)}</div>
        ) : (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-[85vw] max-w-[320px] border-r border-border bg-sidebar p-0">
              {renderSidebar(true)}
            </SheetContent>
          </Sheet>
        )}

        {/* main */}
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <ChatHeader
            title={headerTitle}
            project={headerProject}
            model={model}
            models={MODELS}
            onModelChange={setModel}
            onToggleSidebar={() => (isDesktop ? null : setSidebarOpen(true))}
            onToggleSettings={() => setSettingsOpen(true)}
          />

          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="scrollbar-thin scroll-fast absolute inset-0 overflow-y-auto"
            >
              <MessageList messages={view} sessionId={activeThreadId} />
              {thinking && <ThinkingIndicator />}
            </div>

            {showJump && (
              <button
                onClick={scrollToBottom}
                aria-label="Jump to latest"
                className="absolute bottom-3 left-1/2 z-10 grid size-9 -translate-x-1/2 touch-manipulation place-items-center rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur transition hover:bg-accent hover:text-primary"
              >
                <ArrowDown className="size-4" />
              </button>
            )}
          </div>

          <Composer
            onSend={handleSend}
            onCancel={cancel}
            busy={busy}
            connected={connected || !activeThreadId}
            sessionId={activeThreadId}
          />
        </div>

        {/* settings sheet */}
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetContent
            side="right"
            className={cn(
              "border-l border-border bg-sidebar p-0",
              isTablet && !isDesktop ? "w-[360px]" : "w-[85vw] max-w-[360px]",
            )}
          >
            <SettingsPanel
              models={MODELS}
              activeModelId={activeModelId}
              efforts={EFFORTS}
              effort={effort}
              sessionEffort={sessionEffort}
              onEffortChange={setEffort}
              disabledTools={disabledTools}
              toolsEditable={!!activeThreadId}
              onToolsChange={handleToolsChange}
              onLogout={handleLogout}
            />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

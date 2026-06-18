import { useMemo } from "react";
import { ArrowDown } from "lucide-react";
import { MessageList } from "./message-list";
import { useSocket } from "@/lib/ws";
import { eventsToMessages } from "@/lib/adapt";
import { useTask } from "@/hooks/use-automation-data";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";

/** Live, read-only render of a task session's event stream. No composer.
 *  Falls back to the REST event history for finished/replayed tasks.
 *  Auto-scrolls to the bottom as output streams in, just like the chat view. */
export function TaskOutput({ taskId }: { taskId: string }) {
  const { messages: raw } = useSocket(taskId);
  const detail = useTask(taskId);
  const live = useMemo(() => eventsToMessages(raw), [raw]);
  const replay = useMemo(() => eventsToMessages(detail.data?.events ?? []), [detail.data]);
  const messages = live.length > 0 ? live : replay;

  // Follow the live bottom as events stream; switching tasks re-engages follow.
  const { scrollRef, contentRef, showJump, onScroll, scrollToBottom } = useStickToBottom(
    [messages],
    taskId,
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-thin scroll-fast absolute inset-0 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No output yet.</p>
          </div>
        ) : (
          <div ref={contentRef}>
            <MessageList messages={messages} sessionId={taskId} />
          </div>
        )}
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
  );
}

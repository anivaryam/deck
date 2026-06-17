import { useMemo } from "react";
import { MessageList } from "./message-list";
import { useSocket } from "@/lib/ws";
import { eventsToMessages } from "@/lib/adapt";
import { useTask } from "@/hooks/use-automation-data";

/** Live, read-only render of a task session's event stream. No composer.
 *  Falls back to the REST event history for finished/replayed tasks. */
export function TaskOutput({ taskId }: { taskId: string }) {
  const { messages: raw } = useSocket(taskId);
  const detail = useTask(taskId);
  const live = useMemo(() => eventsToMessages(raw), [raw]);
  const replay = useMemo(() => eventsToMessages(detail.data?.events ?? []), [detail.data]);
  const messages = live.length > 0 ? live : replay;
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

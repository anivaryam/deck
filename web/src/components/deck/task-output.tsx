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

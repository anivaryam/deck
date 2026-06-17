import { createFileRoute } from "@tanstack/react-router";
import { DeckView } from "@/components/deck/deck-view";

export const Route = createFileRoute("/$threadId")({
  component: ThreadRoute,
});

function ThreadRoute() {
  const { threadId } = Route.useParams();
  return <DeckView activeThreadId={threadId} />;
}

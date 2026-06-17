import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { DeckView } from "@/components/deck/deck-view";

export const Route = createFileRoute("/")({
  // Auth probe + entry routing. 401 → login. Existing sessions → open the most
  // recent. No sessions → fall through to the empty cold-start console.
  beforeLoad: async () => {
    let sessions;
    try {
      sessions = await api.sessions();
    } catch {
      throw redirect({ to: "/login" });
    }
    if (sessions.length > 0) {
      throw redirect({ to: "/$threadId", params: { threadId: sessions[0].id } });
    }
  },
  component: () => <DeckView activeThreadId={undefined} />,
});

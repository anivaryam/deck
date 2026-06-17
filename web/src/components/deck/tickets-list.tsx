import { cn } from "@/lib/utils";
import { StatusChip, StatusDot } from "./status-chip";
import { normalizeTicketStatus, relativeTime, type TicketTab } from "@/lib/automation";
import type { Ticket } from "@/lib/types";

export function TicketsList({
  tickets,
  tabs,
  activeTab,
  onTab,
  selectedId,
  onSelect,
}: {
  tickets: Ticket[];
  tabs: readonly TicketTab[];
  activeTab: TicketTab;
  onTab: (t: TicketTab) => void;
  selectedId: string | null;
  onSelect: (t: Ticket) => void;
}) {
  return (
    <>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2.5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            className={cn(
              "whitespace-nowrap rounded-full border border-transparent px-3 py-1 text-xs capitalize text-muted-foreground",
              activeTab === t && "border-border bg-accent text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="p-2">
        {tickets.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No tickets.</p>
        )}
        {tickets.map((t) => {
          const status = normalizeTicketStatus(t.status);
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border border-transparent px-3.5 py-3 text-left",
                selectedId === t.id ? "border-border bg-card" : "hover:border-border hover:bg-card",
              )}
            >
              <StatusDot status={status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{t.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {relativeTime(t.created_at)}
                </span>
              </span>
              <StatusChip status={status} />
            </button>
          );
        })}
      </div>
    </>
  );
}

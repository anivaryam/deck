import { cn } from "@/lib/utils";
import { statusChipClass, statusDotClass, type AutomationStatus } from "@/lib/automation";

export function StatusDot({ status, className }: { status: AutomationStatus; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", statusDotClass(status), className)} />;
}

export function StatusChip({ status, label }: { status: AutomationStatus; label?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        statusChipClass(status),
      )}
    >
      {label ?? status}
    </span>
  );
}

import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNotifications } from "@/hooks/use-notifications";

/** Bell toggle that opts the user in/out of native browser notifications for
 *  finished task & cron runs. Hidden entirely where the browser has no
 *  Notification API (e.g. iOS Safari before "Add to Home Screen"). */
export function NotificationsToggle() {
  const { supported, enabled, blocked, enable, disable } = useNotifications();

  if (!supported) return null;

  const onClick = async () => {
    if (enabled) {
      disable();
      toast.success("Notifications off");
      return;
    }
    const p = await enable();
    if (p === "granted") toast.success("Notifications on — you'll be alerted when runs finish");
    else if (p === "denied") toast.error("Blocked in browser settings — re-enable there to use notifications");
  };

  const label = blocked
    ? "Notifications blocked in browser settings"
    : enabled
      ? "Notifications on — click to mute"
      : "Notify me when runs finish";

  const Icon = blocked ? BellOff : enabled ? BellRing : Bell;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={blocked}
          aria-pressed={enabled}
          aria-label={label}
          className={enabled ? "text-primary" : "text-muted-foreground"}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

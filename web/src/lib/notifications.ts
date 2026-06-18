import type { TaskFrame } from "./automation-events";

/** localStorage flag — the user explicitly opted in via the bell toggle.
 *  Permission alone is not enough: a granted permission can outlive the user's
 *  intent, so we gate native notifications on this flag AND the permission. */
export const NOTIFICATIONS_ENABLED_KEY = "deck:notifications-enabled";

const SW_URL = "/sw.js";

/** True when this browser exposes the Notification API at all.
 *  False on iOS Safari until the app is added to the Home Screen (a PWA). */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function getPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}

/** Register the service worker. Required for notifications on mobile; harmless on
 *  desktop. The SW has no fetch handler, so it never interferes with HMR/assets. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch {
    return null;
  }
}

/** Prompt for permission. Must be called from a user gesture. */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return getPermission();
  }
}

/** True when the user opted in AND the browser still grants permission. */
export function notificationsEnabled(): boolean {
  return (
    notificationsSupported() &&
    getPermission() === "granted" &&
    localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === "1"
  );
}

/** Show a native OS notification.
 *  Prefers the service-worker registration (the only path that works on Android
 *  Chrome); falls back to the page-context constructor on desktop browsers. */
export async function showNotification(title: string, options: NotificationOptions = {}): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const opts: NotificationOptions = { icon: "/favicon.svg", badge: "/favicon.svg", ...options };
  try {
    const reg =
      "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg && "showNotification" in reg) {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    /* fall through to the constructor */
  }
  try {
    // Throws on Android Chrome (SW-only) — guarded so it degrades silently there.
    new Notification(title, opts);
  } catch {
    /* unsupported in this context */
  }
}

export type TaskNotification = { title: string; body: string; intent: "success" | "error" };

/** Map a task lifecycle frame to a notification, or null when none should fire.
 *  Covers manual TASK runs as well as CRON/TICKET runs (the ticket asks to notify
 *  "if task is done and cron is done"). Skips still-running and cancelled runs. */
export function notificationForTask(f: TaskFrame): TaskNotification | null {
  if (f.status === "active") return null;
  const kind = f.source_kind === "cron" ? "Cron" : f.source_kind === "ticket" ? "Ticket" : "Task";
  const noun = kind.toLowerCase();
  if (f.result === "success") {
    return { intent: "success", title: `${kind} finished`, body: `A ${noun} run completed successfully.` };
  }
  if (f.result === "error") {
    return { intent: "error", title: `${kind} failed`, body: `A ${noun} run ended with an error.` };
  }
  if (f.result === "queue_full") {
    return { intent: "error", title: `${kind} dropped`, body: `A ${noun} run was skipped — the queue was full.` };
  }
  return null; // cancelled or unknown result
}

import { useCallback, useEffect, useState } from "react";
import {
  NOTIFICATIONS_ENABLED_KEY,
  getPermission,
  notificationsSupported,
  registerServiceWorker,
  requestPermission,
} from "@/lib/notifications";

/** React state around browser notification opt-in.
 *  Persists the user's choice in localStorage so it survives reloads, and keeps
 *  the live permission state in sync. `enabled` is true only when the user opted
 *  in AND the browser still grants permission. */
export function useNotifications() {
  const supported = notificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission>(() => getPermission());
  const [optedIn, setOptedIn] = useState<boolean>(
    () => typeof localStorage !== "undefined" && localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === "1",
  );

  // Re-sync if permission was revoked/changed from browser settings or elsewhere.
  useEffect(() => {
    if (!supported) return;
    setPermission(getPermission());
  }, [supported]);

  const enable = useCallback(async (): Promise<NotificationPermission> => {
    const p = await requestPermission();
    setPermission(p);
    if (p === "granted") {
      await registerServiceWorker();
      localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, "1");
      setOptedIn(true);
    }
    return p;
  }, []);

  const disable = useCallback(() => {
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, "0");
    setOptedIn(false);
  }, []);

  return {
    supported,
    permission,
    enabled: optedIn && permission === "granted",
    blocked: permission === "denied",
    enable,
    disable,
  };
}

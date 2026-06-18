/* Claude Deck service worker.
 *
 * Purpose is narrow: make browser notifications work on MOBILE. Android Chrome
 * forbids the `new Notification()` constructor in a page context and only allows
 * notifications shown via `ServiceWorkerRegistration.showNotification()`. iOS
 * Safari only exposes the Notification API at all once the app is added to the
 * Home Screen (a PWA), which the web manifest enables.
 *
 * Deliberately NO `fetch` handler and NO caching: this SW must not interfere with
 * Vite HMR in dev or asset loading in prod. It only relays notification clicks.
 */

self.addEventListener("install", () => {
  // Activate immediately so the first page load can show notifications.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Focus an existing tab (or open one) when a notification is clicked.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

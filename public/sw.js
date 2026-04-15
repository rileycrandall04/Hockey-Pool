/* Service worker for draft-turn push notifications.
 *
 * Registered from the draft room on user opt-in. Handles two events:
 *
 *   1. "push"              — a push message arrived from the browser's
 *                            push service. Show a native OS notification.
 *
 *   2. "notificationclick" — the user tapped the notification. Focus an
 *                            existing tab on the draft room if possible,
 *                            otherwise open a new one.
 *
 * Installed on the site root as /sw.js so it can control the whole
 * origin (required for Web Push).
 */

self.addEventListener("install", (event) => {
  // Activate immediately on install — this service worker is single-
  // purpose and doesn't have migration concerns.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of open tabs right away.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Non-JSON payload is fine; keep the empty object.
  }

  const title = payload.title || "Stanley Cup Pool";
  const options = {
    body: payload.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    vibrate: [200, 100, 200, 100, 400],
    tag: payload.tag || "draft-clock",
    renotify: true,
    requireInteraction: false,
    data: {
      url: payload.url || "/dashboard",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    (async () => {
      // If there's already a draft-room tab open for this origin,
      // focus it instead of opening a new one.
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.pathname.startsWith("/leagues/")) {
            await client.focus();
            if (client.url !== targetUrl) {
              client.navigate(targetUrl).catch(() => {});
            }
            return;
          }
        } catch (e) {
          // ignore
        }
      }

      // No existing tab — open a new one.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

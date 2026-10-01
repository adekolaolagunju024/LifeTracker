// Push-reminders service worker — this is its entire job: show a system
// notification when a push arrives, and focus/open the app when it's
// tapped. No caching, no offline support; the manifest.json install
// experience doesn't depend on this file existing.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Waypoint', body: 'You have a reminder.' };
  try { data = { ...data, ...event.data.json() }; } catch {}
  // "urgent" (overdue alerts, focus nudges) stays on screen until actually
  // dismissed instead of auto-disappearing after a few seconds, and
  // vibrates — the whole point of these two is to interrupt a scrolling
  // session, not blend into the notification shade unnoticed. The
  // due-today ping and test notification stay soft/informational.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
      requireInteraction: !!data.urgent,
      vibrate: data.urgent ? [300, 150, 300, 150, 300] : [200],
      tag: data.tag || undefined,
      renotify: !!data.tag,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

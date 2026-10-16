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
  let data = { title: 'StartLine', body: 'You have a reminder.' };
  try { data = { ...data, ...event.data.json() }; } catch {}
  // "urgent" (overdue alerts, focus nudges) stays on screen until actually
  // dismissed instead of auto-disappearing after a few seconds, and
  // vibrates — the whole point of these two is to interrupt a scrolling
  // session, not blend into the notification shade unnoticed. The
  // due-today ping and test notification stay soft/informational.
  // A task alarm also tells any open StartLine tab, which shows its own
  // full-screen alarm with sound on top of the system notification.
  const extra = data.data || {};
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/', ...extra },
      requireInteraction: !!data.urgent,
      vibrate: data.urgent ? [300, 150, 300, 150, 300] : [200],
      tag: data.tag || undefined,
      renotify: !!data.tag,
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
    }),
    extra.reminderId ? self.clients.matchAll({ type: 'window' }).then(clients => clients.forEach(c => c.postMessage({ type: 'reminder', reminderId: extra.reminderId }))) : null,
  ]));
});

// Opens (or focuses) the app at `url`, so a tap always lands somewhere
// useful even when StartLine wasn't open.
function openApp(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        if (url && 'navigate' in client && url.includes('reminder=')) return client.focus().then(c => c.navigate(url)).catch(() => client.focus());
        return client.focus();
      }
    }
    return self.clients.openWindow(url || '/');
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/';
  // Task alarm buttons: Snooze is answered right here, without opening
  // anything; Start opens the task with its 2-minute timer running.
  if (data.reminderId && event.action === 'snooze') {
    event.waitUntil(fetch(`/api/reminders/${encodeURIComponent(data.reminderId)}/snooze`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 10 }),
    }).catch(() => openApp(url)));
    return;
  }
  if (data.reminderId && event.action === 'start') {
    event.waitUntil(openApp(url + (url.includes('?') ? '&' : '?') + 'start=1'));
    return;
  }
  event.waitUntil(openApp(url));
});

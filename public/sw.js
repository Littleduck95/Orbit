// Orbit's service worker. It only handles notifications: it shows a push
// when one arrives, even with Orbit closed, and opens Orbit when one is
// tapped. It caches nothing, so every visit loads the site as it is now.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const scope = self.registration.scope;
  event.waitUntil(self.registration.showNotification(data.title || 'Orbit', {
    body: data.body || '',
    tag: data.tag || 'orbit',
    renotify: Boolean(data.tag),
    icon: `${scope}icon-192.png`,
    badge: `${scope}badge-96.png`,
    // Only ever opens Orbit itself, whatever a push says.
    data: { url: typeof data.url === 'string' && data.url.startsWith(scope) ? data.url : scope },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const here = open.find((c) => c.url.startsWith(self.registration.scope));
    if (here) return here.focus();
    return self.clients.openWindow(url);
  })());
});

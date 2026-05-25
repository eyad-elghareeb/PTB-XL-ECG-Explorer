self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
  // Clear all client tabs to force-reload
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      if (client.url && "navigate" in client) {
        client.navigate(client.url);
      }
    });
  });
});

self.addEventListener("fetch", (event) => {
  // Always fetch from network to avoid any dev caching issues
  event.respondWith(fetch(event.request));
});

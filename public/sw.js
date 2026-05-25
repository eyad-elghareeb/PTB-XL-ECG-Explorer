const CACHE_NAME = "ptbxl-ecg-cache-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // Focus caching strategy specifically for dynamic API calls like /api/records or /api/ecg/[id]
  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(
      // Try to fetch from network first so we have the latest database queries
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, respClone);
            });
          }
          return response;
        })
        .catch(() => {
          // If offline, fall back directly to the cached API result
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return informative mock JSON if completely unavailable
            return new Response(
              JSON.stringify({ error: "Offline: clinical record not found in local browser cache." }),
              { headers: { "Content-Type": "application/json" } }
            );
          });
        })
    );
    return;
  }

  // Fallback pattern for normal static website files (JS, CSS, HTML)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const respClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, respClone);
          });
        }
        return networkResponse;
      });
    })
  );
});

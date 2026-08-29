/* =========================================================
   কোথায়দেখব — Service Worker
   Goal: make the app installable on Chrome/Android/desktop and
   let the app shell (HTML/CSS/JS/icons) open instantly, even
   offline. TMDB API calls are network-only — movie data and
   "where to watch" info must always be fresh, never cached.
   ========================================================= */

const CACHE_VERSION = "k2d-shell-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin API/image calls (TMDB) — always go to network
  // so streaming availability and search results are never stale.
  if (url.origin !== self.location.origin) return;

  // App shell: cache-first (fast load, works offline), refresh cache in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

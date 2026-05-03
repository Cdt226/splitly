const CACHE_NAME = "splitly-v3";
const STATIC_ASSETS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const method = event.request.method;

  // Ne jamais mettre en cache :
  // - Les requêtes POST, PUT, PATCH, DELETE
  // - Les URLs /api/
  // - Les URLs Supabase
  // - Les URLs Resend
  if (
    method !== "GET" ||
    url.includes("/api/") ||
    url.includes("supabase.co") ||
    url.includes("resend.com") ||
    url.includes("anthropic")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Pour les requêtes GET uniquement : réseau d'abord, cache en fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Ne mettre en cache que les réponses valides
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Mise à jour automatique
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
const CACHE_NAME = "splitly-v5";
const STATIC_ASSETS = ["/", "/index.html", "/icon-192.png", "/icon-512.png", "/manifest.json"];

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
  const { request } = event;
  const url = request.url;

  // Pass-through: non-GET, API calls, external services
  if (
    request.method !== "GET" ||
    url.includes("/api/") ||
    url.includes("supabase.co") ||
    url.includes("resend.com") ||
    url.includes("anthropic") ||
    url.includes("fonts.googleapis.com") ||
    url.includes("fonts.gstatic.com")
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, serve the app shell so React Router can handle it
          if (request.mode === "navigate") return caches.match("/index.html");
          return new Response("", { status: 503, statusText: "Offline" });
        })
      )
  );
});

// ── Notifications push ─────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || "SplitLy", {
        body: data.body || "",
        icon: data.icon || "/icon-192.png",
        badge: data.badge || "/icon-192.png",
        data: { url: data.url || "/" },
        vibrate: [200, 100, 200],
        requireInteraction: false,
      })
    );
  } catch {}
});

// Clic sur notification → ouvrir / focus l'app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

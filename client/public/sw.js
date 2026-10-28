const CACHE = "kasirku-v1";
const ASSETS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Abaikan skema yang tidak didukung (chrome-extension, dll)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  // Hanya cache GET
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          // Hanya simpan response yang valid & same-origin
          if (
            res &&
            res.status === 200 &&
            res.type === "basic" &&
            url.origin === self.location.origin
          ) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => {
              c.put(e.request, clone).catch(() => {});
            });
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetched;
    })
  );
});
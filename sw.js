// Version 3: Seiten und Skripte kommen immer zuerst aus dem Netz (also aktuell),
// nur ohne Verbindung wird die gespeicherte Kopie gezeigt. Bilder und Schriften kommen aus dem Zwischenspeicher.
const CACHE_NAME = "stundenformular-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL).catch((err) => {
        console.warn("Konnte nicht alle App-Shell-Dateien cachen:", err);
      })
    )
  );
  self.skipWaiting();
});

// Alte Zwischenspeicher (z. B. "stundenformular-v2" mit veralteten Dateien) werden gelöscht
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has("vcheck")) return;

  const isStatic = /\.(png|jpe?g|svg|webp|ico|woff2?)$/i.test(url.pathname);

  if (request.mode === "navigate" || !isStatic) {
    // Seiten, Skripte, Stile: erst das Netz, damit nie etwas Altes hängen bleibt
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((r) => r || (request.mode === "navigate" ? caches.match("./index.html") : null) || Response.error())
        )
    );
    return;
  }

  // Bilder und Schriften: aus dem Zwischenspeicher, sonst Netz
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

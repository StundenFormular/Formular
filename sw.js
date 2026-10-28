// Version 5: Seiten kommen zuerst aus dem Netz (mit kurzer Rückfrage „unverändert?“), damit nie etwas Altes hängen bleibt.
// Dateien mit Versionsnummer im Namen (zum Beispiel dp-admin.33.js) ändern sich nie und kommen sofort aus dem Zwischenspeicher.
// Wird ein solches Skript je OHNE neuen Namen geändert, muss CACHE_NAME hochgezählt werden.
const CACHE_NAME = "stundenformular-v5";

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

  const isStatic = /\.(png|jpe?g|svg|webp|ico|woff2?)$/i.test(url.pathname) || /[.-]\d+(\.\d+)*(\.min)?\.(js|css|mjs)$/i.test(url.pathname);   // Bilder, Schriften und Dateien mit Versionsnummer

  if (request.mode === "navigate" || !isStatic) {
    // Seiten und alles ohne Versionsnummer: erst das Netz (mit Rückfrage), damit nie etwas Altes hängen bleibt
    event.respondWith(
      fetch(request, { cache: "no-cache" })
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

  // Bilder, Schriften und versionierte Dateien: aus dem Zwischenspeicher, sonst Netz
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

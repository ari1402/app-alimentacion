// Service worker: offline básico + notificaciones push del coach.
const VERSION = "v2";
// Carpeta donde vive la app ("/" o "/app-alimentacion/" en GitHub Pages)
const BASE = new URL("./", self.location).pathname;
const withBase = (p) => BASE + String(p || "").replace(/^\//, "");
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, withBase("manifest.webmanifest"), withBase("icon.svg")])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith(withBase("api/"))) return; // Supabase/IA: siempre red
  if (req.mode === "navigate") {
    // Red primero; sin conexión, la app desde caché
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(BASE, copy)); return res; })
        .catch(() => caches.match(BASE)),
    );
    return;
  }
  if (url.pathname.startsWith(withBase("assets/"))) {
    // Archivos con hash: caché primero
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(ASSETS).then((c) => c.put(req, copy));
        return res;
      })),
    );
  }
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Coach", body: e.data ? e.data.text() : "" }; }
  const title = data.title || "Coach";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "coach",
      renotify: true,
      icon: withBase("icon-192.png"),
      badge: withBase("icon-192.png"),
      data: { url: data.url || "/", eventId: data.eventId || null },
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url = "/", eventId = null } = e.notification.data || {};
  let target = e.action === "log" && !url.startsWith("/registrar") ? "/registrar" : url;
  if (eventId) target += (target.includes("?") ? "&" : "?") + "ev=" + encodeURIComponent(eventId);
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.postMessage({ type: "navigate", url: target }); // ruta interna: el router agrega la base
          return w.focus();
        }
      }
      return self.clients.openWindow(withBase(target));
    }),
  );
});

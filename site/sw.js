/* FOMO · fonctionne hors connexion et s'installe sur l'écran d'accueil.
   L'app (index.html) est toujours rechargée depuis le réseau quand il y en a un : chaque mise à jour sur Netlify arrive tout de suite. */
const CACHE = "fomo-v56";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  // les fonctions du serveur (agenda .ics, Strava, corrections…) ne passent jamais par le cache :
  // sinon l'iPhone n'ouvre pas le fichier agenda, et les réponses restaient figées
  if (u.origin === location.origin && u.pathname.startsWith("/.netlify/")) return;
  // l'app elle-même : réseau d'abord, copie locale si pas de réseau
  const isApp = u.origin === location.origin && /^\/(index\.html)?$/.test(u.pathname);
  if (isApp) {
    e.respondWith(fetch(r).then(res => { if (res.ok && /text\/html/.test(res.headers.get("content-type") || "")) { const c = res.clone(); caches.open(CACHE).then(x => x.put("./index.html", c)); } return res; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  if (r.mode === "navigate") return;
  // icônes et polices : copie locale d'abord
  if ((u.origin === location.origin && /\.(png|jpg|svg|ico|webmanifest|woff2?)$/.test(u.pathname)) || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok || res.type === "opaque") { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; })));
  }
  // le reste (billetteries, robot GitHub, Deezer…) passe directement par le réseau
});
// toucher une notification : ouvre (ou ramène au premier plan) l'app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => ws.length ? ws[0].focus() : self.clients.openWindow("./")));
});

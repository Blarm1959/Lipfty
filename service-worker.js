const VERSION = "0.0.11";
const STATIC_CACHE = `lipfty-static-v${VERSION}`;
const RUNTIME_CACHE = `lipfty-runtime-v${VERSION}`;
const APP_SHELL = [
  "./", "./index.html", "./offline.html", "./css/style.css",
  "./js/app.js", "./js/rules.js", "./manifest.json", "./package.json",
  "./release.json", "./build-info.json",
  "./icons/lipfty-96.png", "./icons/lipfty-128.png", "./icons/lipfty-144.png", "./icons/lipfty-152.png",
  "./icons/lipfty-180.png", "./icons/lipfty-192.png", "./icons/lipfty-384.png", "./icons/lipfty-512.png",
  "./icons/lipfty-maskable-192.png", "./icons/lipfty-maskable-512.png"
];
self.addEventListener("install", event => event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL))));
self.addEventListener("activate", event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("./index.html")) || caches.match("./offline.html")));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});

/* 껍데기만 캐시한다. 대회 자료는 항상 서버에서 새로 받는다 — 순위가 굳으면 안 되기 때문이다. */
const CACHE = 'hackon-v1';
const SHELL = ['/app', '/hack-on.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;          // 데이터는 캐시하지 않는다
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

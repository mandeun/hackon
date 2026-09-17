/* 껍데기만 캐시한다. 대회 자료는 항상 서버에서 새로 받는다 — 순위가 굳으면 안 되기 때문이다.

   v1 은 캐시를 먼저 봤다(cache-first). 그래서 배포를 해도 한 번 열어 본 브라우저는
   옛 /app 을 계속 봤다. 실제로 그렇게 됐다 — 고친 것이 사용자에게 며칠 동안 안 갔다.
   지금은 서버를 먼저 보고, 인터넷이 끊겼을 때만 캐시를 쓴다.
   행사장 와이파이는 반드시 죽기 때문에 캐시 자체는 그대로 둔다. */
const CACHE = 'hackon-v2';
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
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        /* 받아 온 것으로 캐시를 갈아 끼운다. 다음에 인터넷이 끊겨도 최신이 나온다. */
        if (r && r.ok && u.origin === self.location.origin) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      /* 여기까지 왔으면 인터넷이 없다. 캐시에도 없으면 브라우저 기본 오류로 넘긴다.
         찾을 때 지금 캐시 안에서만 찾는다 - caches.match 는 옛 캐시까지 다 뒤져서,
         지우다 만 옛 껍데기가 인터넷 끊긴 순간에 되살아난다. */
      .catch(() => caches.open(CACHE).then(c => c.match(e.request))
                         .then(r => r || Response.error()))
  );
});

/* 껍데기만 캐시한다. 대회 자료는 항상 서버에서 새로 받는다 — 순위가 굳으면 안 되기 때문이다.

   v1 은 캐시를 먼저 봤다(cache-first). 그래서 배포를 해도 한 번 열어 본 브라우저는
   옛 /app 을 계속 봤다. 실제로 그렇게 됐다 — 고친 것이 사용자에게 며칠 동안 안 갔다.
   지금은 서버를 먼저 보고, 인터넷이 끊겼을 때만 캐시를 쓴다.
   행사장 와이파이는 반드시 죽기 때문에 캐시 자체는 그대로 둔다.

   v3: 끊겼는데 캐시에도 없는 화면이면 브라우저 오류(공룡) 대신 offline.html 을 보여 준다.
   안드로이드 앱(TWA)에서는 그 오류 화면이 «앱이 깨졌다» 로 읽힌다 — 플레이 심사가 실제로 본다. */
const CACHE = 'hackon-v3';
const OFFLINE = '/offline.html';
const SHELL = ['/app', '/hack-on.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', OFFLINE, '/norangi.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== self.location.origin) return;        // 밖의 글꼴 등은 브라우저에 맡긴다
  /* 네트워크만: 데이터(/api/)와 달력 파일(.ics). 달력 앱이 옛 일정을 받으면 안 된다.
     달력 파일은 지금 둘 다 /api/ 아래(/api/cal/<토큰>.ics, /api/events/<id>/ics)지만,
     .ics 가 다른 길에 새로 생겨도 캐시에 안 남게 확장자로도 막는다 */
  if (u.pathname.startsWith('/api/') || u.pathname.endsWith('.ics')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        /* 받아 온 것으로 캐시를 갈아 끼운다. 다음에 인터넷이 끊겨도 최신이 나온다. */
        if (r && r.ok && !u.search) {   // ?k=<열쇠> 가 붙은 주소는 캐시에 안 남긴다(감사 21)
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      /* 여기까지 왔으면 인터넷이 없다. 찾을 때 지금 캐시 안에서만 찾는다 - caches.match 는 옛 캐시까지
         다 뒤져서, 지우다 만 옛 껍데기가 인터넷 끊긴 순간에 되살아난다.
         캐시에도 없을 때: 화면 이동(주소창·링크)이면 offline.html, 그림·스크립트 같은 나머지는 오류 그대로. */
      .catch(() => caches.open(CACHE).then(c => c.match(e.request)
        .then(r => r || (e.request.mode === 'navigate' ? c.match(OFFLINE) : undefined)))
        .then(r => r || Response.error()))
  );
});

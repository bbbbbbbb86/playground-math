/* 操場數學練習器 service worker
   - 只快取本網站自己的靜態檔（遊戲外殼、程式、圖示），其他網域（例如字型）直接走網路。
   - 版本號改變時建立新快取，舊快取在啟用時刪除。
   - 新版本會先「等待」，由頁面顯示「有更新」並在玩家按下後才切換，不會在作答途中強制刷新。 */
const VERSION = '2.6.1-22b5267d';
const CACHE = 'pgm-shell-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './app.js',
  './pwa.js',
  './pwa.css',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pgm-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 其他網域不經過快取

  // 頁面：用這個版本快取的首頁（和程式檔同一版）；還沒快取時走網路；都沒有就顯示離線頁
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html')
        .then((hit) => hit || fetch(req))
        .catch(() => caches.match('./offline.html'))
    );
    return;
  }

  // 外殼檔案：用這個版本的快取（版本一致），快取沒有才走網路
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});

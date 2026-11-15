/* 记忆小站 · 离线缓存
 *
 * 策略：网络优先，失败回落缓存。
 *   —— 早期版本用的是「缓存优先」，结果一旦缓存过旧版 JS，
 *      服务器更新后浏览器永远返回旧文件，改了也看不到效果。
 *      现在改成网络优先：联网时永远拿最新，只有断网才用缓存，
 *      PWA 的离线能力保留，但不会再"卡在旧版本"。
 *
 * 云端 API（/.cloud/**）一律不拦截，直接走网络。
 * 学习数据始终在 localStorage，与本缓存无关。
 */
const CACHE = 'ebbinghaus-kids-v16';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './print.html',
  './css/app.css',
  './js/meta.js',
  './js/strings.js',
  './js/data-en.js',
  './js/data-zh.js',
  './js/data-py.js',
  './js/py-dict.js',
  './js/audio-manifest.js',
  './js/srs.js',
  './js/store.js',
  './js/speech.js',
  './js/cloud.js',
  './js/app.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  // 页面可以要求立即接管
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  // 云端接口不缓存，避免登录态/数据被旧响应污染
  if (url.pathname.indexOf('/.cloud/') === 0) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
  );
});

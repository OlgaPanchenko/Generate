/* NewsDrop — service worker.
 *
 * Раньше здесь было «сначала кэш, потом сеть»: после публикации новой версии
 * страницы браузер продолжал показывать старую, пока кэш не протухнет. Теперь
 * для страниц и скриптов сначала спрашиваем сеть, а кэш держим как запасной
 * вариант на случай, когда интернета нет.
 */
const CACHE_NAME = 'newsdrop-cache-v3';
const APP_SHELL = [
  '1.html', '2.html', '3.html', '4.html', '5.html', '6.html',
  'post-templates.js', 'data-source.js', 'publisher-bridge.js',
  'manifest.json', 'icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Одного отсутствующего файла достаточно, чтобы addAll отвалился целиком,
    // и тогда не закэшируется вообще ничего — поэтому кладём по одному.
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // чужие домены не трогаем

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error()))
  );
});

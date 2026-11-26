const cacheName = 'stack-solver-v39';
const assets = ['./', './index.html', './assets/stack-trainer-logo.png', './app.css?v=33', './app.css?v=35', './app.css?v=36', './app.mjs', './i18n.mjs', './solver.mjs', './presets.mjs', './worker.mjs',
  './app.mjs?v=35', './solver.mjs?v=35', './worker.mjs?v=35', './i18n.mjs?v=35', './route-replay.mjs?v=35',
  './trainer.html', './trainer.css?v=33', './trainer.css?v=34', './trainer.css?v=35', './trainer.css?v=36', './trainer.mjs?v=34', './trainer.mjs?v=35', './assistant-scan.mjs?v=1', './assistant-scan.mjs?v=2', './assistant-scan.mjs?v=39', './assistant-scan-logic.mjs', './assistant-scan-logic.mjs?v=39', './vendor/ocrad/ocrad.js', './trainer-copy.mjs?v=30', './trainer-progress.mjs', './drills.mjs', './stack-library.mjs', './stack-csv.mjs',
  './beyond.mjs?v=34', './beyond-copy.mjs?v=34', './jazzing.mjs?v=34', './drills.mjs?v=33'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('stack-solver-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !assets.some(path => new URL(path, self.location).href === request.url)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(cacheName).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(() => caches.match(request)));
});

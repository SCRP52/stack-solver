const cacheName = 'stack-solver-v49';
const assets = ['./', './index.html', './assets/stack-trainer-logo.png', './app.css?v=33', './app.css?v=35', './app.css?v=36', './app.mjs', './i18n.mjs', './solver.mjs', './presets.mjs', './worker.mjs',
  './app.mjs?v=35', './solver.mjs?v=35', './worker.mjs?v=35', './i18n.mjs?v=35', './route-replay.mjs?v=35',
  './trainer.html', './trainer.css?v=33', './trainer.css?v=34', './trainer.css?v=35', './trainer.css?v=36', './trainer.css?v=45', './trainer.css?v=48',
  './trainer.mjs?v=34', './trainer.mjs?v=35', './trainer.mjs?v=42', './trainer.mjs?v=43', './trainer.mjs?v=44',
  './assistant-scan.mjs?v=42', './assistant-scan.mjs?v=45', './assistant-scan.mjs?v=46', './assistant-scan.mjs?v=47', './assistant-scan.mjs?v=48', './assistant-scan.mjs?v=49',
  './assistant-detail.mjs?v=49',
  './assistant-camera.mjs?v=45', './assistant-camera.mjs?v=46', './assistant-camera.mjs?v=47', './assistant-camera.mjs?v=48',
  './assistant-scan-logic.mjs?v=39', './assistant-scan-logic.mjs?v=46', './assistant-scan-logic.mjs?v=48', './assistant-corners.mjs?v=41', './assistant-packet.mjs?v=42',
  './assistant-diagnostics.mjs?v=42', './assistant-diagnostics.mjs?v=45', './assistant-diagnostics.mjs?v=46', './assistant-diagnostics.mjs?v=47', './assistant-diagnostics.mjs?v=48', './assistant-diagnostics.mjs?v=49', './assistant-card-shapes.mjs?v=40', './vendor/ocrad/ocrad.js',
  './trainer-copy.mjs?v=30', './trainer-progress.mjs', './drills.mjs', './stack-library.mjs', './stack-csv.mjs',
  './beyond.mjs?v=34', './beyond.mjs?v=42', './beyond.mjs?v=43', './beyond.mjs?v=44',
  './beyond-copy.mjs?v=34', './beyond-copy.mjs?v=42', './beyond-copy.mjs?v=43', './beyond-copy.mjs?v=44', './jazzing.mjs?v=34', './drills.mjs?v=33'];

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

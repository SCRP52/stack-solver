const cacheName = 'stack-solver-v33';
const assets = ['./', './index.html', './app.css?v=33', './app.mjs', './i18n.mjs', './solver.mjs', './presets.mjs', './worker.mjs',
  './app.mjs?v=33', './solver.mjs?v=32', './worker.mjs?v=32', './i18n.mjs?v=32',
  './trainer.html', './trainer.css?v=33', './trainer.mjs?v=33', './trainer-copy.mjs?v=30', './trainer-progress.mjs', './drills.mjs', './stack-library.mjs', './stack-csv.mjs',
  './beyond.mjs', './beyond-copy.mjs', './jazzing.mjs', './drills.mjs?v=33'];

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

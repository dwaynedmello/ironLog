/* IRONLOG offline cache */
const CACHE = 'ironlog-v7';
const ASSETS = ['./', './index.html'];
const NET_TIMEOUT = 2500;   // gym wifi gets one shot, then we serve from cache

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(key, res) {
  if (res && res.ok && res.type !== 'opaque') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  /* The whole app is one HTML file, so page loads go network-first: a new build
     lands as soon as there is signal, and the cached copy covers no signal. */
  if (e.request.mode === 'navigate') {
    const live = fetch(e.request).then(res => store('./index.html', res));
    const fallback = new Promise(r => setTimeout(r, NET_TIMEOUT))
      .then(() => caches.match('./index.html'));
    e.respondWith(
      Promise.race([live, fallback])
        .then(res => res || live)
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request)
        .then(res => store(e.request, res))
        .catch(() => caches.match('./index.html'))
    )
  );
});

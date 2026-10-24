const CACHE_NAME = 'hokkaido-seven-days-v17';
// Wikimedia photo thumbnails live in their own cache so a new itinerary version does not wipe them
const PHOTO_CACHE = 'hokkaido-photos-v1';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];
// Single-page app: every navigation (incl. links shared from WeChat with ?from=…) shares one cache entry
const PAGE_KEY = new URL('./', self.registration.scope).href;

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser HTTP cache, so a fresh deploy is precached instead of a 10-minute-old copy
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME && key !== PHOTO_CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

// Tell open pages that a newer itinerary just landed in the cache, so they can offer a one-tap reload
// The refresh often finishes while the reloaded page is still loading (not yet a client), so tell again a moment later
function notifyUpdated() {
  const post = () => self.clients.matchAll({ type: 'window' })
    .then(clients => clients.forEach(client => client.postMessage({ type: 'itinerary-updated' })));
  return post().then(() => new Promise(resolve => setTimeout(resolve, 2500))).then(post);
}

// Stale-While-Revalidate: serve cache instantly (works on bad snow-day signal), refresh in background
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Cache-first for photo thumbnails: once seen online, they keep showing on a snowy no-signal day
  if (new URL(event.request.url).hostname === 'thumb.wikimedia.org') {
    event.respondWith(caches.open(PHOTO_CACHE).then(cache => cache.match(event.request).then(hit => hit ||
      fetch(event.request).then(response => {
        if (response.ok) cache.put(event.request, response.clone()).catch(() => {});
        return response;
      }))));
    return;
  }
  if (new URL(event.request.url).origin !== self.location.origin) return;
  const isPage = event.request.mode === 'navigate';
  const key = isPage ? PAGE_KEY : event.request;
  const work = caches.open(CACHE_NAME).then(cache => cache.match(key, { ignoreSearch: true }).then(cached => {
    // clone now: the cached copy's body is consumed once it is handed to the page
    const shown = isPage && cached ? cached.clone() : null;
    const refresh = fetch(event.request.url, { cache: 'no-cache' }).then(response => {
      if (!response.ok) return response;
      const compare = shown ? Promise.all([shown.text(), response.clone().text()]) : null;
      return Promise.all([cache.put(key, response.clone()).catch(() => {}), compare])
        .then(([, texts]) => texts && texts[0] !== texts[1] && notifyUpdated())
        .then(() => response);
    });
    return { cached, refresh };
  }));
  event.respondWith(work.then(({ cached, refresh }) => cached || refresh.catch(() => caches.match(PAGE_KEY))));
  event.waitUntil(work.then(({ refresh }) => refresh).catch(() => {}));
});

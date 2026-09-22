/**
 * sw.js — Maths Manthra Service Worker
 * Strategy:
 *  - PRECACHE: App shell (CSS, JS, icons, fonts page, offline fallback)
 *  - RUNTIME:
 *    • CSS/JS/Images → StaleWhileRevalidate (fast + stays fresh)
 *    • HTML navigation → NetworkFirst with offline fallback
 *    • API/data → NetworkOnly (never serve stale dynamic data)
 *    • YouTube/external → passthrough (no caching)
 */

const CACHE_VERSION = 'mm-v1';
const PRECACHE_NAME = `precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = `runtime-${CACHE_VERSION}`;

// ─── App Shell: Files to pre-cache on install ──────────────────────────────
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/css/main.css',
  '/css/admin.css',
  '/js/main.js',
  '/js/admin.js',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/icon-maskable-192.png',
  '/images/icon-maskable-512.png',
  '/images/apple-touch-icon.png',
  '/images/MM_Logo.jpg',
  '/manifest.json',
];

// ─── Install: Pre-cache the app shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())  // Activate immediately
  );
});

// ─── Activate: Clean up old caches ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== PRECACHE_NAME && name !== RUNTIME_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())  // Take control of all clients
  );
});

// ─── Fetch: Runtime caching strategies ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST forms, etc.)
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (YouTube embeds, CDN fonts load directly, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip admin API routes and auth routes (never cache dynamic data)
  if (url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/admin/') && request.headers.get('accept')?.includes('application/json')) {
    return;
  }

  // ── Strategy 1: Static Assets → StaleWhileRevalidate ─────────────────
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ── Strategy 2: HTML Navigation → NetworkFirst with offline fallback ──
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // ── Strategy 3: Everything else → NetworkFirst ────────────────────────
  event.respondWith(networkFirst(request));
});

// ─── Helper: Is this a static asset? ───────────────────────────────────────
function isStaticAsset(pathname) {
  return /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|json)$/i.test(pathname) ||
         pathname.startsWith('/images/') ||
         pathname.startsWith('/css/') ||
         pathname.startsWith('/js/');
}

// ─── Strategy: StaleWhileRevalidate ────────────────────────────────────────
// Serve from cache immediately, update cache in background
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || fetchPromise;
}

// ─── Strategy: NetworkFirst with Offline Fallback ──────────────────────────
// Try network first; if offline, fall back to cache then offline page
async function networkFirstWithFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(RUNTIME_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Network failed — try cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    // Last resort — offline fallback page
    const offlinePage = await caches.match('/offline.html');
    return offlinePage || new Response('You are offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// ─── Strategy: NetworkFirst ────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(RUNTIME_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || new Response('', { status: 503 });
  }
}

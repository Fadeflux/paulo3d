/* Paulo3D — service worker : l'application s'ouvre même sans réseau.
   Les données ne passent JAMAIS par ici : elles sont gérées par l'appli (IndexedDB + Supabase). */
const VERSION = '__APP_VERSION__';
const SHELL_CACHE = `p3d-shell-${VERSION}`;
const CDN_CACHE = 'p3d-cdn-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const CDN = __CDN_URLS__;
const FONT_CSS = '__FONT_CSS__';
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN.map(async ({ url, cors }) => {
      if (await cdn.match(url, { ignoreVary: true })) return;
      try {
        const res = await fetch(url, { mode: cors ? 'cors' : 'no-cors', credentials: 'omit' });
        if (res.ok || res.type === 'opaque') await cdn.put(url, res);
      } catch (e) { /* réessayé à la prochaine ouverture */ }
    }));
    try {
      const res = await fetch(FONT_CSS, { mode: 'cors', credentials: 'omit' });
      if (res.ok) {
        const css = await res.clone().text();
        await cdn.put(FONT_CSS, res);
        const blocks = css.split('/*').filter((b) => /^\s*latin(-ext)? \*\//.test(b));
        const urls = [...new Set(blocks.flatMap((b) => [...b.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1])))];
        await Promise.all(urls.map(async (u) => {
          if (await cdn.match(u, { ignoreVary: true })) return;
          try {
            const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
            if (r.ok) await cdn.put(u, r);
          } catch (e) { /* police facultative */ }
        }));
      }
    } catch (e) { /* polices système en secours */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('p3d-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    if (req.mode === 'navigate') {
      event.respondWith((async () => {
        const shell = await caches.open(SHELL_CACHE);
        const cached = (await shell.match('./index.html')) || (await shell.match('./'));
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch (e) {
          return new Response('<p style="font-family:system-ui;padding:24px">Paulo3D : pas de connexion et application pas encore installée sur cet appareil.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      })());
      return;
    }
    event.respondWith((async () => {
      const shell = await caches.open(SHELL_CACHE);
      const cached = await shell.match(req, { ignoreSearch: true });
      return cached || fetch(req);
    })());
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cdn = await caches.open(CDN_CACHE);
      const cached = await cdn.match(req.url, { ignoreVary: true });
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cdn.put(req.url, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) {
        if (url.hostname === 'fonts.googleapis.com') event.waitUntil(network);
        return cached;
      }
      const res = await network;
      return res || new Response('', { status: 504, statusText: 'Hors-ligne' });
    })());
  }
});

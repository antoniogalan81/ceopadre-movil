// CEOPadre · service worker. SÓLO la carcasa de la app (HTML, CSS, JS, iconos) en una caché versionada.
// Los datos (Supabase: proyectos, órdenes, sesión) nunca pasan por aquí: van siempre a la red y no se guardan.
// VERSION la sella tools/publish-mobile.mjs con la huella del contenido: cada publicación es una caché nueva.
const VERSION = 'fad7e31d0332';
const CACHE = `ceopadre-${VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'zones.js', 'dom.js', 'map.js', 'remoto.js', 'zip.js', 'automatizaciones.js', 'negocio.js', 'mama.js', 'mama-plan.js', 'redactor.js', 'alquiler.js', 'modal.js', 'tarjeta.js', 'config.js', 'vendor/supabase.js', 'manifest.webmanifest',
  'logo.png', 'gestiones.svg', 'mama-avatar-64.png', 'mama-avatar-128.png', 'icono-v2-192.png', 'icono-v2-512.png', 'icono-v2-maskable-512.png', 'apple-touch-icon-v2.png', 'favicon.ico'];

self.addEventListener('install', (e) => {
  // Sin skipWaiting: la versión nueva espera a que Antonio pulse ACTUALIZAR (nunca recarga por sorpresa).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ceopadre-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

// AVISOS (Web Push): el PC los cifra para este dispositivo; aquí sólo se enseñan. Un toque abre CEOPadre.
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'CEOPadre', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'CEOPadre', { body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag,
    icon: 'icono-v2-192.png', badge: 'icono-v2-192.png', data: { url: m.url || '' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) if ('focus' in c) { await c.focus(); if (e.notification.data?.url) c.navigate?.(url); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Otro origen (Supabase: datos, auth, Realtime) o no-GET: red directa, sin tocar la caché.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length) || './';
  const isShell = req.mode === 'navigate' || SHELL.includes(path);
  if (!isShell) return; // cualquier otra cosa del mismo origen: red, sin guardar
  // Carcasa: de la caché de ESTA versión (coherente y disponible sin conexión); si falta, red.
  e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req.mode === 'navigate' ? './' : req)) || fetch(req)));
});

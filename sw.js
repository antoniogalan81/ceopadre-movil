// CEOPadre · service worker. SÓLO la carcasa de la app (HTML, CSS, JS, iconos) en una caché versionada.
// Los datos (Supabase: proyectos, órdenes, sesión) nunca pasan por aquí: van siempre a la red y no se guardan.
// VERSION la sella tools/publish-mobile.mjs con la huella del contenido: cada publicación es una caché nueva.
const VERSION = 'b79f58f8197d';
const CACHE = `ceopadre-${VERSION}`;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'zones.js', 'config.js', 'vendor/supabase.js', 'manifest.webmanifest',
  'logo.png', 'gestiones.svg', 'icono-192.png', 'icono-512.png', 'icono-maskable-512.png', 'apple-touch-icon.png', 'favicon.ico'];

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

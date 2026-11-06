// Al publicar cambios, sube VERSION aquí, en index.html (HD_VERSION y los
// ?v= de los scripts) y en js/app.js (HD_APP_VERSION). Una prueba lo verifica.
const VERSION = '20261105';
const CACHE = 'hdcredit-' + VERSION;
// La app completa se guarda de una vez: si algo falla, esta versión no se
// instala y sigue la anterior, sin mezclar HTML y JS de versiones distintas.
const SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  ...['datos', 'sesion', 'sync', 'negocio', 'ui', 'export', 'rescate', 'app'].map(n => `./js/${n}.js?v=${VERSION}`)
];
// Pueden faltar: el sitio de prueba no publica config-real.js. El SDK se guarda
// para que el teléfono pueda abrir el login sin red tras una actualización.
const OPCIONALES = [
  `./js/config-real.js?v=${VERSION}`,
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'
];

const guardarOpcional = (c, u) => fetch(new Request(u, u.startsWith('http') ? { mode: 'no-cors', cache: 'reload' } : { cache: 'reload' }))
  .then(res => (res.ok || res.type === 'opaque') ? c.put(u, res) : null)
  .catch(() => {});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))
        .then(() => Promise.all(OPCIONALES.map(u => guardarOpcional(c, u)))))
      .then(() => self.skipWaiting())
  );
});

// Activar — limpia caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch — Network First para HTML/JS, Cache First para íconos/manifest
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const mismoOrigen = url.origin === self.location.origin;
  const isHTML = e.request.destination === 'document' || (mismoOrigen && (url.pathname.endsWith('.html') || url.pathname.endsWith('/')));
  const isScript = e.request.destination === 'script';

  if (isHTML || isScript) {
    // Network first: siempre intenta red, fallback a cache solo si offline.
    // no-cache: revalida con el servidor en vez de usar la caché HTTP del
    // navegador, que podría devolver un HTML o JS viejo.
    e.respondWith(
      (mismoOrigen ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request))
        .then(res => {
          // Un 404 o 500 nunca reemplaza la copia buena que ya estaba guardada
          if (res.ok || res.type === 'opaque') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request)
          .then(r => r || (isHTML ? caches.match('./index.html') : null))
          .then(r => r || Response.error()))
    );
  } else {
    // Cache first para estáticos (íconos, fuentes, CSS externo)
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});

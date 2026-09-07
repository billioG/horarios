const CACHE = 'asistencia-v11';
const ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './db.js',
  './cloud.js',
  './app.js',
  './horarios.js',
  './reportes.js',
  './manifest.json',
  './icon-pc.png',
  './pc.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Solo cachear GET del propio origen (los archivos de la app). Todo lo demás
  // — en particular las llamadas POST/PUT/PATCH/DELETE a la Edge Function en
  // otro dominio — se deja pasar sin tocar. Interceptarlas rompía esas
  // peticiones ("Failed to fetch") porque no tiene sentido cachear escrituras.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((resp) => resp || fetch(req))
  );
});

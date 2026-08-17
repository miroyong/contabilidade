/* Controle Financeiro — Service Worker (PWA)
 * Caca estáticos (app shell) em cache-first; NÃO caça o backend
 * Apps Script (cross-origin) nem respostas de API para não servir
 * dados velhos. Ao instalar/fazer update, pré-grava os assets atuais.
 * Suba VER a cada deploy para forçar refresh do shell.
 */
const VER = 'contabilidade-v22';
const CACHE = VER;
const PRECACHE = [
  './',
  './index.html',
  './style.css?v=22',
  './config.js?v=22',
  './app.js?v=22',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégias de fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API do Apps Script / planilha / qualquer origem externa: network-only.
  // Não intercepta para nunca servir dados de lançamento desatualizados.
  if (url.origin !== self.location.origin) return;

  // Apenas os assets do app shell (mesmo origin). Cache-first com
  // actualização em background (stale-while-revalidate leve).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

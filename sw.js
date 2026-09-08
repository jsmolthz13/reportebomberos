// =============================================================
// SERVICE WORKER - BOMBEROS PEDRAZA (MEJORADO, manejo resiliente)
// =============================================================

const CACHE_NAME = 'bomberos-pedraza-v1';
const OFFLINE_URL = './index.html';

const urlsToCache = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// Instalación: cachea recursos, pero no falla si alguno no responde correctamente
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Intentamos cachear cada recurso pero no bloqueamos la instalación si alguno falla.
      await Promise.allSettled(
        urlsToCache.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            // Aceptamos responses OK o tipo opaque (cross-origin sin CORS)
            if (!response) throw new Error('No response');
            if (response.status === 200 || response.type === 'opaque' || response.type === 'cors') {
              try {
                await cache.put(url, response.clone());
                console.log('[SW] Cacheado:', url);
              } catch (err) {
                console.warn('[SW] No se pudo cachear (put):', url, err);
              }
            } else {
              console.warn('[SW] Respuesta no OK, omitiendo cache:', url, response.status, response.type);
            }
          } catch (err) {
            console.warn('[SW] Error al obtener recurso para cache:', url, err);
          }
        })
      );
      return self.skipWaiting();
    })
  );
});

// Activación: limpia caches antiguos
self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Eliminando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      console.log('[SW] Activación completada');
      return self.clients.claim();
    })
  );
});

// Fetch: solo maneja GET; estrategia stale-while-revalidate para recursos cacheados
self.addEventListener('fetch', event => {
  // No interceptar peticiones que no sean GET (POST, PUT, etc.)
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);

    // Empieza la petición de red en segundo plano para actualizar cache
    const networkFetch = fetch(event.request).then(async networkResponse => {
      try {
        // Asegurar que la respuesta es cacheable
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque' || networkResponse.type === 'cors')) {
          try {
            await cache.put(event.request, networkResponse.clone());
          } catch (err) {
            // put puede fallar por razones (CORS, storage), no interrumpimos
            console.warn('[SW] cache.put falló para', event.request.url, err);
          }
        }
      } catch (err) {
        console.warn('[SW] Error procesando respuesta de red para cache:', err);
      }
      return networkResponse;
    }).catch(err => {
      // La petición de red falló (offline u otro)
      return null;
    });

    // Si hay cachedResponse, devuélvelo inmediatamente y actualiza en background.
    if (cachedResponse) {
      // Ejecutar fetch en background (no await) para refrescar cache
      networkFetch.then(() => {}).catch(()=>{});
      return cachedResponse;
    }

    // Si no hay cache, espera la respuesta de red (si falla, fallback offline)
    const netResp = await networkFetch;
    if (netResp) return netResp;

    // Si es navegación y no hay red, devolver offline page desde cache
    if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
      const fallback = await cache.match(OFFLINE_URL);
      if (fallback) return fallback;
    }

    // Último recurso: intentar devolver cachedResponse (null en este punto) o una respuesta 503
    return new Response('Contenido no disponible offline', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  })());
});

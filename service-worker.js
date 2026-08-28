const CACHE_NAME = "asistia-pwa-v1.1.0-build10048"

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.webmanifest",
  "/pwa-register.js",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/asistIA_logo.png",
  "/24_logo.png",
  "/B129logo.png",
  "/asistencia/index.html",
  "/asistencia/style.css",
  "/asistencia/app.js",
  "/justificaciones/index.html",
  "/justificaciones/style.css",
  "/justificaciones/app.js"
]

const CRITICAL_ASSETS = [
  "/app.js",
  "/version-manager.js",
  "/update-notifier.js",
  "/app-version.json",
  "/asistencia/app.js",
  "/justificaciones/app.js"
]

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

const CACHE_PREFIX = "asistia-pwa-"

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

function resolveNavigationFallback(pathname = "/") {
  if (pathname.includes("/staff-asistencia")) return "/staff-asistencia/index.html"
  if (pathname.includes("/asistencia")) return "/asistencia/index.html"
  if (pathname.includes("/justificaciones")) return "/justificaciones/index.html"
  return "/index.html"
}

self.addEventListener("fetch", event => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Excluir solicitudes al módulo Staff y a su SW para delegarlas a su SW específico
  if (url.pathname.includes("/staff-asistencia") || url.pathname === "/staff-service-worker.js") {
    return
  }

  // 1. Estrategia Network-First para navegación (HTML)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone))
        }
        return response
      }).catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        return caches.match(resolveNavigationFallback(url.pathname))
      })
    )
    return
  }

  // 2. Estrategia Network-First para archivos críticos (JS y JSON)
  const isCritical = CRITICAL_ASSETS.includes(url.pathname)
  if (isCritical) {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone))
        }
        return response
      }).catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        return new Response("Servicio no disponible temporalmente (offline y sin caché)", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        })
      })
    )
    return
  }

  // 3. Estrategia Cache-First para otros archivos precargados (estáticos, imágenes, estilos)
  if (!PRECACHE_URLS.includes(url.pathname)) return

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone))
        }
        return response
      })
    })
  )
})

// =====================================================================
// EVENTOS DE NOTIFICACIONES PUSH
// =====================================================================

self.addEventListener("push", event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    console.error("[backoffice-sw] Error al parsear JSON de push:", e)
  }

  const title = data.title || "asistIA Backoffice"
  const options = {
    body: data.body || "Actualización de asistencia",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/index.html"
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

self.addEventListener("notificationclick", event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || "/index.html"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url)
          if ((clientUrl.pathname === "/" || clientUrl.pathname.includes("index.html")) && "focus" in client) {
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      })
  )
})

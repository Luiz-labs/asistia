const CACHE_NAME = "asistia-staff-pwa-v1.1.0-build10029"

const PRECACHE_URLS = [
  "/staff-asistencia/index.html",
  "/staff-asistencia/style.css",
  "/staff-asistencia/app.js",
  "/version-manager.js",
  "/update-notifier.js",
  "/icon-192.png",
  "/icon-512.png",
  "/asistIA_logo.png"
]

const CRITICAL_ASSETS = [
  "/staff-asistencia/app.js",
  "/version-manager.js",
  "/update-notifier.js"
]

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

const CACHE_PREFIX = "asistia-staff-pwa-"

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", event => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

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
        return caches.match("/staff-asistencia/index.html")
      })
    )
    return
  }

  // 2. Estrategia Network-First para archivos críticos (JS)
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
        return new Response("Servicio no disponible temporalmente (offline)", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        })
      })
    )
    return
  }

  // 3. Estrategia Cache-First para otros archivos precargados
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
    console.error("[staff-sw] Error al parsear JSON de push:", e)
  }

  const title = data.title || "asistIA Staff"
  const options = {
    body: data.body || "Actualización de asistencia",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/"
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

self.addEventListener("notificationclick", event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || "/staff-asistencia/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          const clientUrl = new URL(client.url)
          if (clientUrl.pathname.includes("staff-asistencia") && "focus" in client) {
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      })
  )
})

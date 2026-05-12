(() => {
  if (!("serviceWorker" in navigator)) return
  if (!window.isSecureContext && !/localhost|127\.0\.0\.1/.test(window.location.hostname)) return

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(error => {
      console.warn("No se pudo registrar el service worker de asistIA:", error)
    })
  })
})()

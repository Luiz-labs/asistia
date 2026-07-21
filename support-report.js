// asistIA - Utilidad compartida para reporte de problemas y soporte por WhatsApp
// File: support-report.js

function obtenerVersionAsistIA() {
    if (typeof window.obtenerEtiquetaVersionAsistia === "function") {
        return window.obtenerEtiquetaVersionAsistia("short")
    }
    if (window.asistiaVersion) {
        return `v${window.asistiaVersion.version} · ${window.asistiaVersion.build}`
    }
    const footerText = String(document.querySelector(".public-footer")?.textContent || "").trim()
    const match = footerText.match(/asistIA\s+(v[^\s·]+|[\d\.\w\-]+)/i)
    if (match && match[1]) {
        return match[1].replace(/^v/i, "")
    }
    return "v0.9.5-beta · 20260722.001"
}

function generarIdReporteComun(prefijo, idValor) {
    const ahora = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const yyyy = ahora.getFullYear()
    const mm = pad(ahora.getMonth() + 1)
    const dd = pad(ahora.getDate())
    const hh = pad(ahora.getHours())
    const min = pad(ahora.getMinutes())
    const ss = pad(ahora.getSeconds())
    const idLimpio = String(idValor || "").replace(/[^\w]/g, "").slice(0, 12) || "SIN_ID"
    return `${prefijo}-${yyyy}${mm}${dd}-${hh}${min}${ss}-${idLimpio}`
}

function obtenerDatosDispositivoEstructurados() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    return {
        userAgent: navigator.userAgent || "Desconocido",
        plataforma: navigator.platform || "Desconocida",
        idioma: navigator.language || "es",
        pantalla: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
        viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
        pixelRatio: window.devicePixelRatio || 1,
        online: navigator.onLine ? "Online" : "Offline",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
        hardwareConcurrency: navigator.hardwareConcurrency || "No disponible",
        deviceMemory: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "No disponible",
        maxTouchPoints: navigator.maxTouchPoints || 0,
        orientacion: window.screen?.orientation?.type || "Desconocida",
        conexion: conn ? {
            effectiveType: conn.effectiveType || "Desconocido",
            downlink: conn.downlink ? `${conn.downlink} Mbps` : "Desconocido",
            rtt: conn.rtt ? `${conn.rtt} ms` : "Desconocido",
            saveData: conn.saveData ? "Sí" : "No"
        } : null
    }
}

function obtenerDatosDispositivoReporte() {
    const d = obtenerDatosDispositivoEstructurados()
    return `Datos automáticos del dispositivo:
- User agent: ${d.userAgent}
- Plataforma: ${d.plataforma}
- Idioma: ${d.idioma}
- Tamaño de pantalla: ${d.pantalla}
- Online/offline: ${d.online}
- Timezone: ${d.timezone}`
}

function abrirWhatsAppSoporteMensaje(textoMensaje) {
    const url = `https://wa.me/51983230353?text=${encodeURIComponent(textoMensaje)}`
    window.open(url, "_blank")
}

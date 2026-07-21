// asistIA - Utilidad compartida para reporte de problemas y soporte por WhatsApp
// File: support-report.js

function obtenerVersionAsistIA() {
    const footerText = String(document.querySelector(".public-footer")?.textContent || "").trim()
    const match = footerText.match(/asistIA\s+(v[^\s·]+|[\d\.\w\-]+)/i)
    if (match && match[1]) {
        return match[1].replace(/^v/i, "")
    }
    const script = document.querySelector('script[src*="app.js"]')
    if (script && script.src) {
        try {
            const urlParams = new URL(script.src, window.location.origin).searchParams
            const versionParam = urlParams.get("v")
            if (versionParam) return versionParam
        } catch (e) {}
    }
    return "1.0.0"
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

function obtenerDatosDispositivoReporte() {
    return `Datos automáticos del dispositivo:
- User agent: ${navigator.userAgent}
- Plataforma: ${navigator.platform || "Desconocida"}
- Idioma: ${navigator.language || "es"}
- Tamaño de pantalla: ${window.screen.width || 0}x${window.screen.height || 0}
- Online/offline: ${navigator.onLine ? "Online" : "Offline"}
- Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima"}`
}

function abrirWhatsAppSoporteMensaje(textoMensaje) {
    const url = `https://wa.me/51983230353?text=${encodeURIComponent(textoMensaje)}`
    window.open(url, "_blank")
}

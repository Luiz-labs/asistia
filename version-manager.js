/**
 * asistIA - Centralized Version Manager
 * File: /version-manager.js
 */
(function () {
    if (window.AsistiaVersionManager) {
        return;
    }

    const INSTALLED_BUILD = "20260722.001";

    const FALLBACK_VERSION = Object.freeze({
        appName: "asistIA",
        version: "0.9.5-beta",
        build: "20260722.001",
        installedBuild: INSTALLED_BUILD,
        releasedAt: "2026-07-22T20:00:00-05:00",
        minimumSupportedBuild: "20260722.001",
        message: "Mejoras de estabilidad, geolocalización y mensajes de asistencia",
        source: "fallback",
        loaded: false,
        error: null
    });

    let estadoVersion = { ...FALLBACK_VERSION };
    let promCarga = null;

    function compararBuildsAsistia(buildA, buildB) {
        const sA = String(buildA || "").trim();
        const sB = String(buildB || "").trim();
        if (sA === sB) return 0;
        if (!sA && sB) return -1;
        if (sA && !sB) return 1;

        const partsA = sA.split(".");
        const partsB = sB.split(".");
        const maxLen = Math.max(partsA.length, partsB.length);

        for (let i = 0; i < maxLen; i++) {
            const pA = partsA[i] || "";
            const pB = partsB[i] || "";

            const numA = parseInt(pA, 10);
            const numB = parseInt(pB, 10);

            const isPureNumA = !isNaN(numA) && String(numA) === pA.replace(/^0+/, "") || (numA === 0 && /^0+$/.test(pA));
            const isPureNumB = !isNaN(numB) && String(numB) === pB.replace(/^0+/, "") || (numB === 0 && /^0+$/.test(pB));

            if (isPureNumA && isPureNumB) {
                if (numA < numB) return -1;
                if (numA > numB) return 1;
            } else {
                if (pA < pB) return -1;
                if (pA > pB) return 1;
            }
        }
        return 0;
    }

    function emitirEventoVersionReady() {
        try {
            window.dispatchEvent(new CustomEvent("asistia:version-ready", {
                detail: Object.freeze({ ...estadoVersion })
            }));
        } catch (e) {
            console.warn("Error emitiendo asistia:version-ready:", e);
        }
    }

    function actualizarFootersEnDOM() {
        const footers = document.querySelectorAll(".public-footer, .main-footer");
        if (!footers.length) return;
        const etiquetaFull = `asistIA v${estadoVersion.version} · Build ${estadoVersion.build}`;
        footers.forEach(el => {
            if (!el.dataset.rawOriginalText) {
                el.dataset.rawOriginalText = el.textContent || "";
            }
            const orig = el.dataset.rawOriginalText;
            const nuevoTexto = orig.replace(/asistIA\s+(v[^\s·]+|[\d\.\w\-]+)(\s+·\s+Build\s+[\d\.\w\-]+)?/gi, etiquetaFull);
            el.textContent = nuevoTexto;
        });
    }

    async function cargarVersionAsistia() {
        if (promCarga) return promCarga;

        promCarga = (async () => {
            try {
                const res = await fetch("/app-version.json", { cache: "no-store" });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} - No se pudo cargar app-version.json`);
                }
                const data = await res.json();
                estadoVersion = {
                    appName: String(data.appName || FALLBACK_VERSION.appName),
                    version: String(data.version || FALLBACK_VERSION.version),
                    build: String(data.build || FALLBACK_VERSION.build),
                    installedBuild: INSTALLED_BUILD,
                    releasedAt: String(data.releasedAt || FALLBACK_VERSION.releasedAt),
                    minimumSupportedBuild: String(data.minimumSupportedBuild || FALLBACK_VERSION.minimumSupportedBuild),
                    message: String(data.message || FALLBACK_VERSION.message),
                    source: "server",
                    loaded: true,
                    error: null
                };
            } catch (err) {
                estadoVersion = {
                    ...FALLBACK_VERSION,
                    installedBuild: INSTALLED_BUILD,
                    source: "fallback",
                    loaded: true,
                    error: String(err?.message || err || "Error desconocido cargando version")
                };
            } finally {
                window.asistiaVersion = Object.freeze({ ...estadoVersion });
                actualizarFootersEnDOM();
                emitirEventoVersionReady();
            }
            return window.asistiaVersion;
        })();

        return promCarga;
    }

    function obtenerVersionAsistia() {
        return estadoVersion.version;
    }

    function obtenerBuildAsistia() {
        return estadoVersion.build;
    }

    function obtenerInstalledBuild() {
        return INSTALLED_BUILD;
    }

    function obtenerEtiquetaVersionAsistia(formato = "full") {
        if (formato === "short") {
            return `v${estadoVersion.version} · ${estadoVersion.build}`;
        }
        return `asistIA v${estadoVersion.version} · Build ${estadoVersion.build}`;
    }

    function obtenerInformacionVersionAsistia() {
        return Object.freeze({ ...estadoVersion });
    }

    // Public API
    window.asistiaVersion = Object.freeze({ ...estadoVersion });
    window.AsistiaVersionManager = Object.freeze({
        cargarVersionAsistia,
        obtenerVersionAsistia,
        obtenerBuildAsistia,
        obtenerInstalledBuild,
        obtenerEtiquetaVersionAsistia,
        obtenerInformacionVersionAsistia,
        compararBuildsAsistia,
        getEtiqueta: obtenerEtiquetaVersionAsistia
    });

    // Exponer funciones globales directas
    window.cargarVersionAsistia = cargarVersionAsistia;
    window.obtenerVersionAsistia = obtenerVersionAsistia;
    window.obtenerBuildAsistia = obtenerBuildAsistia;
    window.obtenerInstalledBuild = obtenerInstalledBuild;
    window.obtenerEtiquetaVersionAsistia = obtenerEtiquetaVersionAsistia;
    window.obtenerInformacionVersionAsistia = obtenerInformacionVersionAsistia;
    window.compararBuildsAsistia = compararBuildsAsistia;

    // Auto-iniciar carga sin bloquear DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            actualizarFootersEnDOM();
            cargarVersionAsistia();
        });
    } else {
        actualizarFootersEnDOM();
        cargarVersionAsistia();
    }
})();

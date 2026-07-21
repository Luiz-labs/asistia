/**
 * asistIA - Shared Update Notifier (Phase 3)
 * File: /update-notifier.js
 */
(function () {
    if (window.AsistiaUpdateNotifier) {
        return;
    }

    const INSTALLED_BUILD = "20260722.001";

    let estadoActualizacion = {
        checked: false,
        installedBuild: INSTALLED_BUILD,
        remoteBuild: null,
        updateAvailable: false,
        source: "unavailable",
        error: null
    };

    let bannerElement = null;

    function inyectarEstilosAviso() {
        if (document.getElementById("asistia-update-notifier-styles")) return;
        const styleEl = document.createElement("style");
        styleEl.id = "asistia-update-notifier-styles";
        styleEl.textContent = `
            .asistia-update-banner {
                margin: 12px 16px 4px 16px;
                padding: 12px 16px;
                background-color: #eff6ff;
                border: 1px solid #bfdbfe;
                border-radius: 12px;
                color: #1e3a8a;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 14px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                box-sizing: border-box;
            }
            .asistia-update-banner-header {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 14px;
                margin-bottom: 4px;
                color: #1d4ed8;
            }
            .asistia-update-banner-body {
                margin-bottom: 10px;
                font-size: 13px;
                line-height: 1.4;
                color: #334155;
            }
            .asistia-update-banner-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }
            .asistia-update-btn-primary {
                background-color: #2563eb;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background-color 0.15s ease;
            }
            .asistia-update-btn-primary:hover {
                background-color: #1d4ed8;
            }
            .asistia-update-btn-secondary {
                background-color: transparent;
                color: #475569;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.15s ease;
            }
            .asistia-update-btn-secondary:hover {
                background-color: #f1f5f9;
            }
        `;
        document.head.appendChild(styleEl);
    }

    function recargarParaActualizarAsistia() {
        try {
            window.location.reload();
        } catch (e) {
            window.location.href = window.location.href;
        }
    }

    function ocultarAvisoActualizacionAsistia() {
        if (bannerElement && bannerElement.parentNode) {
            bannerElement.parentNode.removeChild(bannerElement);
        }
        bannerElement = null;
    }

    function mostrarAvisoActualizacionAsistia(remoteBuild, messageText) {
        inyectarEstilosAviso();
        ocultarAvisoActualizacionAsistia();

        const banner = document.createElement("div");
        banner.className = "asistia-update-banner";
        banner.setAttribute("role", "status");
        banner.setAttribute("aria-live", "polite");

        const msgBody = messageText ? String(messageText).trim() : "Hay una actualización de asistIA lista para cargar.";

        banner.innerHTML = `
            <div class="asistia-update-banner-header">
                <span>🚀 Nueva versión disponible</span>
            </div>
            <div class="asistia-update-banner-body">
                ${msgBody} (Build ${remoteBuild})
            </div>
            <div class="asistia-update-banner-actions">
                <button type="button" class="asistia-update-btn-primary" id="btnAsistiaUpdateNow">Actualizar</button>
                <button type="button" class="asistia-update-btn-secondary" id="btnAsistiaUpdateLater">Ahora no</button>
            </div>
        `;

        // Intentar insertar en contenedor preferido o fallback
        const container = document.querySelector(".public-card") || document.querySelector("main") || document.body;
        if (container.firstChild) {
            container.insertBefore(banner, container.firstChild);
        } else {
            container.appendChild(banner);
        }

        bannerElement = banner;

        document.getElementById("btnAsistiaUpdateNow")?.addEventListener("click", () => {
            recargarParaActualizarAsistia();
        });

        document.getElementById("btnAsistiaUpdateLater")?.addEventListener("click", () => {
            if (remoteBuild) {
                try {
                    sessionStorage.setItem(`asistia_update_dismissed_${remoteBuild}`, "true");
                } catch (e) {}
            }
            ocultarAvisoActualizacionAsistia();
        });
    }

    async function comprobarActualizacionAsistia() {
        if (estadoActualizacion.checked) {
            return Object.freeze({ ...estadoActualizacion });
        }

        const buildLocal = (window.AsistiaVersionManager && typeof window.AsistiaVersionManager.obtenerInstalledBuild === "function")
            ? window.AsistiaVersionManager.obtenerInstalledBuild()
            : INSTALLED_BUILD;

        estadoActualizacion.installedBuild = buildLocal;

        try {
            const res = await fetch(`/app-version.json?t=${Date.now()}`, { cache: "no-store" });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} - No se pudo consultar app-version.json`);
            }
            const data = await res.json();
            const buildRemota = String(data.build || "").trim();

            if (!buildRemota) {
                throw new Error("El JSON remoto no incluye un campo build válido.");
            }

            estadoActualizacion.remoteBuild = buildRemota;
            estadoActualizacion.source = "server";
            estadoActualizacion.checked = true;

            const comparador = (window.AsistiaVersionManager && typeof window.AsistiaVersionManager.compararBuildsAsistia === "function")
                ? window.AsistiaVersionManager.compararBuildsAsistia
                : (a, b) => (a > b ? 1 : a < b ? -1 : 0);

            const esMayor = comparador(buildRemota, buildLocal) === 1;

            if (esMayor) {
                estadoActualizacion.updateAvailable = true;

                const ignoradoEnSesion = sessionStorage.getItem(`asistia_update_dismissed_${buildRemota}`) === "true";

                if (!ignoradoEnSesion) {
                    mostrarAvisoActualizacionAsistia(buildRemota, data.message);
                }

                try {
                    window.dispatchEvent(new CustomEvent("asistia:update-available", {
                        detail: Object.freeze({
                            installedBuild: buildLocal,
                            remoteBuild: buildRemota,
                            version: data.version || "",
                            message: data.message || ""
                        })
                    }));
                } catch (e) {}
            } else {
                estadoActualizacion.updateAvailable = false;
            }
        } catch (err) {
            estadoActualizacion.checked = true;
            estadoActualizacion.updateAvailable = false;
            estadoActualizacion.source = "unavailable";
            estadoActualizacion.error = String(err?.message || err || "Error de red al verificar actualización");
        } finally {
            window.asistiaUpdateStatus = Object.freeze({ ...estadoActualizacion });

            try {
                window.dispatchEvent(new CustomEvent("asistia:update-check-complete", {
                    detail: window.asistiaUpdateStatus
                }));
            } catch (e) {}
        }

        return window.asistiaUpdateStatus;
    }

    function obtenerEstadoActualizacionAsistia() {
        return Object.freeze({ ...estadoActualizacion });
    }

    // Public API
    window.asistiaUpdateStatus = Object.freeze({ ...estadoActualizacion });
    window.AsistiaUpdateNotifier = Object.freeze({
        comprobarActualizacionAsistia,
        mostrarAvisoActualizacionAsistia,
        ocultarAvisoActualizacionAsistia,
        obtenerEstadoActualizacionAsistia,
        recargarParaActualizarAsistia
    });

    window.comprobarActualizacionAsistia = comprobarActualizacionAsistia;
    window.mostrarAvisoActualizacionAsistia = mostrarAvisoActualizacionAsistia;
    window.ocultarAvisoActualizacionAsistia = ocultarAvisoActualizacionAsistia;
    window.obtenerEstadoActualizacionAsistia = obtenerEstadoActualizacionAsistia;
    window.recargarParaActualizarAsistia = recargarParaActualizarAsistia;

    // Auto-iniciar comprobación pasiva una sola vez al cargar la página
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            comprobarActualizacionAsistia();
        });
    } else {
        comprobarActualizacionAsistia();
    }
})();

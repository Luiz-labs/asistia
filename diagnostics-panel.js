/**
 * asistIA - Shared Diagnostics Panel (Phase 4)
 * File: /diagnostics-panel.js
 */
(function () {
    if (window.AsistiaDiagnostics) {
        return;
    }

    let diagnosticoCache = null;
    let modalElement = null;
    let lastActiveElement = null;

    function inyectarEstilosPanel() {
        if (document.getElementById("asistia-diagnostics-styles")) return;
        const style = document.createElement("style");
        style.id = "asistia-diagnostics-styles";
        style.textContent = `
            .support-badge-btn-diag {
                margin-left: 6px;
            }
            .asistia-diagnostics-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                box-sizing: border-box;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .asistia-diagnostics-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(15, 23, 42, 0.6);
                backdrop-filter: blur(4px);
            }
            .asistia-diagnostics-sheet {
                position: relative;
                width: 100%;
                max-width: 540px;
                max-height: 85vh;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-sizing: border-box;
                z-index: 1;
            }
            .asistia-diagnostics-header {
                padding: 16px 20px;
                border-bottom: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }
            .asistia-diagnostics-title {
                margin: 0;
                font-size: 1.1rem;
                font-weight: 700;
                color: #0f172a;
            }
            .asistia-diagnostics-subtitle {
                margin: 4px 0 0 0;
                font-size: 0.8rem;
                color: #64748b;
                line-height: 1.3;
            }
            .asistia-diagnostics-close {
                background: none;
                border: none;
                font-size: 1.5rem;
                line-height: 1;
                color: #94a3b8;
                cursor: pointer;
                padding: 4px;
                border-radius: 6px;
            }
            .asistia-diagnostics-close:hover {
                color: #0f172a;
                background: #f1f5f9;
            }
            .asistia-diagnostics-body {
                padding: 16px 20px;
                overflow-y: auto;
                flex: 1;
                font-size: 0.85rem;
                color: #334155;
            }
            .asistia-diagnostics-section {
                margin-bottom: 16px;
                padding-bottom: 12px;
                border-bottom: 1px solid #f1f5f9;
            }
            .asistia-diagnostics-section:last-child {
                border-bottom: none;
                margin-bottom: 0;
                padding-bottom: 0;
            }
            .asistia-diagnostics-sec-title {
                font-weight: 700;
                font-size: 0.85rem;
                color: #1e293b;
                margin-bottom: 6px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .asistia-diagnostics-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px 12px;
            }
            @media (max-width: 480px) {
                .asistia-diagnostics-grid {
                    grid-template-columns: 1fr;
                }
            }
            .asistia-diagnostics-item {
                display: flex;
                flex-direction: column;
            }
            .asistia-diagnostics-label {
                font-size: 0.75rem;
                color: #64748b;
                font-weight: 500;
            }
            .asistia-diagnostics-val {
                font-size: 0.82rem;
                color: #0f172a;
                font-weight: 600;
                word-break: break-word;
            }
            .asistia-diagnostics-pre {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 10px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 0.75rem;
                color: #334155;
                white-space: pre-wrap;
                max-height: 180px;
                overflow-y: auto;
                margin-top: 8px;
            }
            .asistia-diagnostics-footer {
                padding: 12px 20px;
                border-top: 1px solid #e2e8f0;
                background: #f8fafc;
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }
            .asistia-diag-btn-primary {
                background: #2563eb;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 8px 16px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
            }
            .asistia-diag-btn-primary:hover {
                background: #1d4ed8;
            }
            .asistia-diag-btn-secondary {
                background: #ffffff;
                color: #475569;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 8px 16px;
                font-size: 0.85rem;
                font-weight: 500;
                cursor: pointer;
            }
            .asistia-diag-btn-secondary:hover {
                background: #f1f5f9;
            }
            .asistia-toast {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                background: #0f172a;
                color: #ffffff;
                padding: 10px 20px;
                border-radius: 20px;
                font-size: 0.85rem;
                font-weight: 600;
                box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
                z-index: 100000;
                transition: opacity 0.3s ease;
            }
        `;
        document.head.appendChild(style);
    }

    function mostrarToast(mensaje) {
        inyectarEstilosPanel();
        const toast = document.createElement("div");
        toast.className = "asistia-toast";
        toast.textContent = mensaje;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }, 2200);
    }

    function sanitizarUrlSegura() {
        try {
            return window.location.origin + window.location.pathname;
        } catch (e) {
            return "No disponible";
        }
    }

    function resolverModuloActual() {
        const path = String(window.location.pathname || "").toLowerCase();
        if (path.includes("/justificaciones")) return "Justificaciones";
        if (path.includes("/staff-asistencia")) return "Staff";
        if (path.includes("/asistencia")) return "Aspirantes";
        return "Inicio";
    }

    function resolverTenantActual() {
        if (typeof window.tenantActivoId === "string" && window.tenantActivoId) {
            return window.tenantActivoId.toUpperCase();
        }
        const segments = window.location.pathname.split("/").filter(Boolean);
        if (segments.length > 1) {
            return segments[0].toUpperCase();
        }
        return "GENERAL";
    }

    async function consultarPermisoGpsPasivo() {
        if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
            return "No soportado";
        }
        try {
            const status = await navigator.permissions.query({ name: "geolocation" });
            return String(status?.state || "No disponible");
        } catch (e) {
            return "No disponible";
        }
    }

    async function consultarServiceWorkerPasivo() {
        if (!("serviceWorker" in navigator)) {
            return { soportado: "No", registrado: "No", activo: "No", controlador: "No" };
        }
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            return {
                soportado: "Sí",
                registrado: reg ? "Sí" : "No",
                activo: (reg && reg.active) ? "Sí" : "No",
                controlador: navigator.serviceWorker.controller ? "Sí" : "No",
                scope: reg ? reg.scope : "N/A"
            };
        } catch (e) {
            return { soportado: "Sí", registrado: "No disponible", activo: "No disponible", controlador: "No" };
        }
    }

    /**
     * Consulta pasiva de la cola offline.
     * NOTA ARQUITECTÓNICA DE MANTENIBILIDAD:
     * Actualmente no existe un módulo centralizado window.AsistiaOffline. Por lo tanto,
     * la lectura directa de la clave de localStorage "asistia_asistencia_offline_queue_v1"
     * se mantiene como un fallback desacoplado temporal hasta que se construya la infraestructura
     * de gestión offline compartida en una futura fase.
     */
    function consultarColaOfflinePasiva() {
        const idb = "indexedDB" in window ? "Soportado" : "No soportado";
        let tieneCola = "No";
        let pendientesCount = 0;
        try {
            const raw = localStorage.getItem("asistia_asistencia_offline_queue_v1");
            if (raw) {
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    tieneCola = "Sí";
                    pendientesCount = data.filter(item => item?.estado_sync === "pendiente").length;
                }
            }
        } catch (e) {}

        return {
            indexedDB: idb,
            colaDisponible: tieneCola,
            pendientes: pendientesCount
        };
    }

    function consultarPwaPasiva() {
        const matchStandalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
        const isStandalone = matchStandalone || window.navigator?.standalone === true;
        return {
            standalone: isStandalone ? "Sí (PWA)" : "No (Navegador)",
            displayMode: matchStandalone ? "standalone" : "browser"
        };
    }

    async function recopilarDiagnosticoAsistia() {
        const verManager = window.AsistiaVersionManager;
        const updNotifier = window.AsistiaUpdateNotifier;
        const verInfo = verManager ? verManager.obtenerInformacionVersionAsistia() : (window.asistiaVersion || {});
        const updStatus = updNotifier ? updNotifier.obtenerEstadoActualizacionAsistia() : (window.asistiaUpdateStatus || {});
        
        const deviceData = (typeof window.obtenerDatosDispositivoEstructurados === "function") 
            ? window.obtenerDatosDispositivoEstructurados()
            : {
                userAgent: navigator.userAgent || "Desconocido",
                plataforma: navigator.platform || "Desconocida",
                idioma: navigator.language || "es",
                pantalla: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
                viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
                pixelRatio: window.devicePixelRatio || 1,
                online: navigator.onLine ? "Online" : "Offline",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima"
            };

        const gpsPermiso = await consultarPermisoGpsPasivo();
        const swStatus = await consultarServiceWorkerPasivo();
        const offlineStatus = consultarColaOfflinePasiva();
        const pwaStatus = consultarPwaPasiva();

        const ahora = new Date();
        const fechaHoraLocal = `${ahora.toLocaleDateString("es-PE")} ${ahora.toLocaleTimeString("es-PE")}`;

        const reportObject = {
            appName: verInfo.appName || "asistIA",
            version: verInfo.version || "0.9.5-beta",
            installedBuild: verInfo.installedBuild || "20260722.001",
            remoteBuild: updStatus.remoteBuild || verInfo.build || "No verificado",
            updateAvailable: updStatus.updateAvailable ? "Sí" : "No",
            versionSource: verInfo.source || "fallback",
            modulo: resolverModuloActual(),
            tenant: resolverTenantActual(),
            urlSegura: sanitizarUrlSegura(),
            fechaHoraLocal,
            timezone: deviceData.timezone,
            onlineStatus: deviceData.online,
            conexion: deviceData.conexion ? `${deviceData.conexion.effectiveType} (${deviceData.conexion.downlink})` : "No disponible",
            device: deviceData,
            pwa: pwaStatus,
            serviceWorker: swStatus,
            gpsPermiso,
            offline: offlineStatus
        };

        const reportText = `DIAGNÓSTICO asistIA
Fecha y hora: ${reportObject.fechaHoraLocal}
Módulo: ${reportObject.modulo}
Tenant: ${reportObject.tenant}
Versión: ${reportObject.version}
Build instalada: ${reportObject.installedBuild}
Build remota: ${reportObject.remoteBuild}
Actualización disponible: ${reportObject.updateAvailable}
Fuente de versión: ${reportObject.versionSource}

CONECTIVIDAD Y DISPOSITIVO
Estado de red: ${reportObject.onlineStatus}
Conexión: ${reportObject.conexion}
Modo: ${reportObject.pwa.standalone}
Plataforma: ${deviceData.plataforma}
Pantalla: ${deviceData.pantalla} (Viewport: ${deviceData.viewport}, Ratio: ${deviceData.pixelRatio})
Timezone: ${reportObject.timezone}
User Agent: ${deviceData.userAgent}

ESTADO DE SERVICIOS
Service Worker: ${swStatus.soportado === "Sí" ? (swStatus.activo === "Sí" ? "Activo" : "Registrado (Inactivo)") : "No soportado"}
GPS (Permiso pasivo): ${gpsPermiso}
IndexedDB: ${offlineStatus.indexedDB}
Cola offline pendiente: ${offlineStatus.pendientes}
URL: ${reportObject.urlSegura}`;

        diagnosticoCache = {
            object: reportObject,
            text: reportText
        };

        return diagnosticoCache;
    }

    async function copiarDiagnosticoAsistia() {
        const diag = diagnosticoCache || (await recopilarDiagnosticoAsistia());
        const text = diag.text;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                await navigator.clipboard.writeText(text);
                mostrarToast("✔ Diagnóstico copiado al portapapeles");
                return true;
            }
        } catch (e) {}

        // Fallback textarea
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            ta.remove();
            mostrarToast("✔ Diagnóstico copiado al portapapeles");
            return true;
        } catch (err) {
            mostrarToast("⚠ No se pudo copiar automáticamente");
            return false;
        }
    }

    async function compartirDiagnosticoAsistia() {
        const diag = diagnosticoCache || (await recopilarDiagnosticoAsistia());
        if (navigator.share && typeof navigator.share === "function") {
            try {
                await navigator.share({
                    title: "Diagnóstico asistIA",
                    text: diag.text
                });
                return true;
            } catch (e) {
                if (e.name !== "AbortError") {
                    console.warn("Error al compartir diagnóstico:", e);
                }
                return false;
            }
        } else {
            return copiarDiagnosticoAsistia();
        }
    }

    function cerrarPanelDiagnosticoAsistia() {
        if (modalElement && modalElement.parentNode) {
            modalElement.parentNode.removeChild(modalElement);
        }
        modalElement = null;
        document.body.style.overflow = "";
        if (lastActiveElement && typeof lastActiveElement.focus === "function") {
            try { lastActiveElement.focus(); } catch (e) {}
        }
    }

    async function abrirPanelDiagnosticoAsistia() {
        inyectarEstilosPanel();
        lastActiveElement = document.activeElement;

        if (modalElement) {
            cerrarPanelDiagnosticoAsistia();
        }

        const modal = document.createElement("div");
        modal.className = "asistia-diagnostics-modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "asistiaDiagTitle");

        modal.innerHTML = `
            <div class="asistia-diagnostics-backdrop" id="asistiaDiagBackdrop"></div>
            <section class="asistia-diagnostics-sheet">
                <div class="asistia-diagnostics-header">
                    <div>
                        <h2 class="asistia-diagnostics-title" id="asistiaDiagTitle">🛠 Diagnóstico de asistIA</h2>
                        <p class="asistia-diagnostics-subtitle">Esta información ayuda a identificar problemas técnicos sin incluir datos personales ni contraseñas.</p>
                    </div>
                    <button class="asistia-diagnostics-close" id="btnCloseDiagModal" type="button" aria-label="Cerrar">×</button>
                </div>
                <div class="asistia-diagnostics-body" id="asistiaDiagBody">
                    <p style="text-align: center; color: #64748b; padding: 20px;">Recopilando información técnica pasiva...</p>
                </div>
                <div class="asistia-diagnostics-footer">
                    <button type="button" class="asistia-diag-btn-secondary" id="btnDiagShare" style="display:none;">Compartir</button>
                    <button type="button" class="asistia-diag-btn-primary" id="btnDiagCopy">Copiar diagnóstico</button>
                    <button type="button" class="asistia-diag-btn-secondary" id="btnDiagClose">Cerrar</button>
                </div>
            </section>
        `;

        document.body.appendChild(modal);
        document.body.style.overflow = "hidden";
        modalElement = modal;

        document.getElementById("asistiaDiagBackdrop")?.addEventListener("click", cerrarPanelDiagnosticoAsistia);
        document.getElementById("btnCloseDiagModal")?.addEventListener("click", cerrarPanelDiagnosticoAsistia);
        document.getElementById("btnDiagClose")?.addEventListener("click", cerrarPanelDiagnosticoAsistia);

        const btnShare = document.getElementById("btnDiagShare");
        if (navigator.share && btnShare) {
            btnShare.style.display = "inline-flex";
            btnShare.addEventListener("click", compartirDiagnosticoAsistia);
        }

        const btnCopy = document.getElementById("btnDiagCopy");
        btnCopy?.addEventListener("click", copiarDiagnosticoAsistia);

        modal.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                cerrarPanelDiagnosticoAsistia();
            }
        });

        // Recopilar datos y renderizar cuerpo
        const diag = await recopilarDiagnosticoAsistia();
        const obj = diag.object;
        const bodyEl = document.getElementById("asistiaDiagBody");

        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="asistia-diagnostics-section">
                    <div class="asistia-diagnostics-sec-title">📦 Aplicación y Versión</div>
                    <div class="asistia-diagnostics-grid">
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Versión actual:</span><span class="asistia-diagnostics-val">v${obj.version}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Build instalada:</span><span class="asistia-diagnostics-val">${obj.installedBuild}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Build remota:</span><span class="asistia-diagnostics-val">${obj.remoteBuild}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Actualización:</span><span class="asistia-diagnostics-val">${obj.updateAvailable === "Sí" ? "🚀 Disponible" : "Al día"}</span></div>
                    </div>
                </div>

                <div class="asistia-diagnostics-section">
                    <div class="asistia-diagnostics-sec-title">📍 Contexto y Conectividad</div>
                    <div class="asistia-diagnostics-grid">
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Módulo:</span><span class="asistia-diagnostics-val">${obj.modulo}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Tenant ID:</span><span class="asistia-diagnostics-val">${obj.tenant}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Estado de red:</span><span class="asistia-diagnostics-val">${obj.onlineStatus}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Modo PWA:</span><span class="asistia-diagnostics-val">${obj.pwa.standalone}</span></div>
                    </div>
                </div>

                <div class="asistia-diagnostics-section">
                    <div class="asistia-diagnostics-sec-title">📱 Dispositivo y Servicios</div>
                    <div class="asistia-diagnostics-grid">
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Plataforma:</span><span class="asistia-diagnostics-val">${obj.device.plataforma}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Pantalla:</span><span class="asistia-diagnostics-val">${obj.device.pantalla}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Service Worker:</span><span class="asistia-diagnostics-val">${obj.serviceWorker.activo === "Sí" ? "Activo" : "Inactivo"}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Permiso GPS:</span><span class="asistia-diagnostics-val">${obj.gpsPermiso}</span></div>
                        <div class="asistia-diagnostics-item"><span class="asistia-diagnostics-label">Cola Offline:</span><span class="asistia-diagnostics-val">${obj.offline.pendientes} pendientes</span></div>
                    </div>
                </div>

                <div class="asistia-diagnostics-section">
                    <div class="asistia-diagnostics-sec-title">📄 Reporte técnico copiable</div>
                    <pre class="asistia-diagnostics-pre">${diag.text}</pre>
                </div>
            `;
        }

        try { window.dispatchEvent(new CustomEvent("asistia:diagnostics-ready", { detail: diag.object })); } catch (e) {}
    }

    function acoplarBotonDiscretoTrigger() {
        const container = document.querySelector(".support-badge-container");
        if (container && !document.getElementById("btnDiagnosticoTrig")) {
            const btn = document.createElement("button");
            btn.id = "btnDiagnosticoTrig";
            btn.type = "button";
            btn.className = "support-badge-btn support-badge-btn-diag";
            btn.textContent = "🛠 Diagnóstico";
            btn.addEventListener("click", () => {
                window.AsistiaDiagnostics.abrirPanelDiagnosticoAsistia();
            });
            container.appendChild(btn);
        }
    }

    function obtenerDiagnosticoAsistia() {
        return diagnosticoCache ? Object.freeze({ ...diagnosticoCache.object }) : null;
    }

    // Public API unificada y encapsulada
    window.AsistiaDiagnostics = Object.freeze({
        recopilarDiagnosticoAsistia,
        abrirPanelDiagnosticoAsistia,
        cerrarPanelDiagnosticoAsistia,
        copiarDiagnosticoAsistia,
        compartirDiagnosticoAsistia,
        obtenerDiagnosticoAsistia
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", acoplarBotonDiscretoTrigger);
    } else {
        acoplarBotonDiscretoTrigger();
    }
})();

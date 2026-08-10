const supabaseUrl = "https://kcapmyovaigjntaqeqwn.supabase.co"
const supabaseKey = "sb_publishable_oObf3s5mQ4sfmJ03JKQrnQ__8Rmb63F"

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null

let tenantActivoId = ""
let cursoActualId = null
let cursoContextoValido = true
let staffSeleccionado = null
let staffPerfilEditando = false
let staffPerfilGuardando = false
let staffSuccessResetTimer = null
let staffCurrentView = "login"

let tenantLabel
let codigoBomberoInput
let staffLookupSection
let staffCardSection
let staffSuccessSection
let mensaje
let staffProfileModal

// Variables de PWA e instalación
let courseSelectorSection = null
let courseListContainer = null
let pwaInstallInviteModal = null
let pwaIosGuideModal = null
let deferredPrompt = null

// Variables de notificaciones push
let pwaNotificationCard = null
let btnEnableNotifications = null
let btnDismissNotifications = null

// Clave pública VAPID (debe ser configurada con la correspondiente al backend en producción)
const VAPID_PUBLIC_KEY = "BGF_XF7POyYT3CuhJHeXxTuktu2sgbSmwR3j_wrMv9KBNjdsE3RRKSdMNuUhYd1f3xKQmQuA9R-GnDakGGIZIQo"

window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferredPrompt = e
    console.log("[staff] beforeinstallprompt event captured")
})

function getBuscarStaffButton() {
    return document.getElementById("btnBuscarStaff")
}

function setSectionVisible(element, visible, display = "") {
    if (!element) return
    element.hidden = !visible
    element.style.display = visible ? display : "none"
}

function setStaffView(view, detalle = {}) {
    staffCurrentView = view
    console.log("[staff] view:", view)

    if (staffSuccessResetTimer) {
        clearTimeout(staffSuccessResetTimer)
        staffSuccessResetTimer = null
    }

    const publicCard = document.querySelector(".public-card")
    if (publicCard) {
        publicCard.dataset.staffState = view
    }

    if (view === "login") {
        setSectionVisible(staffLookupSection, true)
        setSectionVisible(courseSelectorSection, false)
        setSectionVisible(staffCardSection, false)
        setSectionVisible(staffSuccessSection, false)
        setSectionVisible(pwaNotificationCard, false)
        setSectionVisible(staffProfileModal, false)
        if (staffProfileModal) staffProfileModal.setAttribute("aria-hidden", "true")
        document.body.classList.remove("staff-modal-open")
        if (!detalle.preserveMessage) setMensaje("")
        if (staffSuccessSection) staffSuccessSection.innerHTML = ""
        return
    }

    if (view === "perfil") {
        setSectionVisible(staffLookupSection, false)
        setSectionVisible(courseSelectorSection, false)
        setSectionVisible(staffCardSection, true)
        setSectionVisible(staffSuccessSection, false)
        setSectionVisible(pwaNotificationCard, false)
        setSectionVisible(staffProfileModal, false)
        if (staffProfileModal) staffProfileModal.setAttribute("aria-hidden", "true")
        document.body.classList.remove("staff-modal-open")
        if (staffSuccessSection) staffSuccessSection.innerHTML = ""
        return
    }

    if (view === "editar") {
        setSectionVisible(staffLookupSection, false)
        setSectionVisible(courseSelectorSection, false)
        setSectionVisible(staffCardSection, false)
        setSectionVisible(staffSuccessSection, false)
        setSectionVisible(pwaNotificationCard, false)
        setSectionVisible(staffProfileModal, true, "flex")
        return
    }

    if (view === "exito") {
        setSectionVisible(staffLookupSection, false)
        setSectionVisible(courseSelectorSection, false)
        setSectionVisible(staffCardSection, false)
        setSectionVisible(staffSuccessSection, true)
        setSectionVisible(pwaNotificationCard, false)
        setSectionVisible(staffProfileModal, false)
        if (staffProfileModal) staffProfileModal.setAttribute("aria-hidden", "true")
        document.body.classList.remove("staff-modal-open")
        if (staffSuccessSection) {
            const nombre = `${normalizarTexto(detalle.nombres)} ${normalizarTexto(detalle.apellidos)}`.replace(/\s+/g, " ").trim()
            staffSuccessSection.innerHTML = `
              <div class="success-badge">Registro exitoso</div>
              <h3>✅ Asistencia staff registrada correctamente</h3>
              <div class="success-summary">
                <div><strong>Nombre</strong><span>${escapeHtml(nombre || "Staff")}</span></div>
                <div><strong>Hora</strong><span>${escapeHtml(detalle.hora || "--:--:--")}</span></div>
                <div><strong>Tipo staff</strong><span>${escapeHtml(detalle.tipo_staff || "APOYO")}</span></div>
              </div>
            `
        }

        if (pwaNotificationCard) {
            pwaNotificationCard.style.borderColor = "#cbd5e1";
            pwaNotificationCard.style.background = "#f8fafc";
            const btnEnable = document.getElementById("btnEnableNotifications");
            const btnDismiss = document.getElementById("btnDismissNotifications");
            const cardTitle = pwaNotificationCard.querySelector("h4");
            const cardText = pwaNotificationCard.querySelector("p");
            if (btnEnable) {
                btnEnable.style.display = "";
                btnEnable.disabled = false;
            }
            if (btnDismiss) {
                btnDismiss.style.display = "";
                btnDismiss.disabled = false;
                btnDismiss.textContent = "Ahora no";
            }
            if (cardTitle) cardTitle.textContent = "Activa las notificaciones";
            if (cardText) cardText.textContent = "Recibe el resumen de asistencia y actualizaciones de la jornada.";
        }

        if (deberiaOfrecerInstalacion()) {
            abrirModalInstalacionPwa();
        } else {
            actualizarEstadoNotificacionesStaff().then(() => {
                if (pwaNotificationCard && pwaNotificationCard.hidden) {
                    staffSuccessResetTimer = setTimeout(() => {
                        resetStaffSeleccionado()
                    }, 3000)
                }
            })
        }
    }
}

function esStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function deberiaOfrecerInstalacion() {
    if (esStandalone()) return false;
    const dismissedAt = localStorage.getItem("asistia_staff_install_dismissed_at");
    if (dismissedAt) {
        const diff = Date.now() - Number(dismissedAt);
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (diff < sevenDaysMs) {
            return false;
        }
    }
    return true;
}

function abrirModalInstalacionPwa() {
    if (!pwaInstallInviteModal) return;
    pwaInstallInviteModal.hidden = false;
    pwaInstallInviteModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("staff-modal-open");
}

function cerrarModalInstalacionPwa() {
    if (!pwaInstallInviteModal) return;
    pwaInstallInviteModal.hidden = true;
    pwaInstallInviteModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("staff-modal-open");
}

function abrirGuiaManualInstalacion() {
    if (!pwaIosGuideModal) return;

    const titleEl = pwaIosGuideModal.querySelector("h3");
    const copyEl = pwaIosGuideModal.querySelector(".ios-install-steps");

    if (esIOS()) {
        if (titleEl) titleEl.textContent = "Instalar Staff en tu iPhone";
        if (copyEl) {
            copyEl.innerHTML = `
                <ol style="margin: 0; padding-left: 20px;">
                  <li style="margin-bottom: 10px;">Asegúrate de estar usando el navegador <strong>Safari</strong>. Si abriste este enlace desde Chrome o Edge, cópialo y ábrelo en Safari.</li>
                  <li style="margin-bottom: 10px;">Pulsa el botón <strong>Compartir</strong> en la barra inferior (el icono de la caja con una flecha hacia arriba <span style="font-size: 1.1rem;">⎋</span>).</li>
                  <li style="margin-bottom: 10px;">Desplázate hacia abajo y selecciona <strong>Añadir a pantalla de inicio</strong> (el icono <span style="font-size: 1.1rem; font-weight: bold;">+</span>).</li>
                  <li style="margin-bottom: 10px;">Confirma que el nombre es <strong>Staff</strong> y pulsa <strong>Añadir</strong> en la esquina superior derecha.</li>
                </ol>
            `;
        }
    } else {
        if (titleEl) titleEl.textContent = "Instalar Staff en tu dispositivo";
        if (copyEl) {
            copyEl.innerHTML = `
                <ol style="margin: 0; padding-left: 20px;">
                  <li style="margin-bottom: 10px;">Pulsa el botón de menú del navegador (tres puntos verticales en la esquina superior o inferior).</li>
                  <li style="margin-bottom: 10px;">Selecciona <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</li>
                  <li style="margin-bottom: 10px;">Confirma la instalación y busca el icono de <strong>Staff</strong> en la pantalla del dispositivo.</li>
                </ol>
            `;
        }
    }

    cerrarModalInstalacionPwa();
    pwaIosGuideModal.hidden = false;
    pwaIosGuideModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("staff-modal-open");
}

function cerrarGuiaManualInstalacion() {
    if (!pwaIosGuideModal) return;
    pwaIosGuideModal.hidden = true;
    pwaIosGuideModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("staff-modal-open");
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function actualizarEstadoNotificacionesStaff() {
    if (!pwaNotificationCard) return;

    // Resetear estilos y elementos
    pwaNotificationCard.style.borderColor = "#cbd5e1";
    pwaNotificationCard.style.background = "#f8fafc";

    const btnEnable = document.getElementById("btnEnableNotifications");
    const btnDismiss = document.getElementById("btnDismissNotifications");
    const cardTitle = pwaNotificationCard.querySelector("h4");
    const cardText = pwaNotificationCard.querySelector("p");

    // 1. Comprobar compatibilidad y disponibilidad de Notification
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        setSectionVisible(pwaNotificationCard, false);
        return;
    }

    // 2. iPhone sin modo standalone
    if (esIOS() && !esStandalone()) {
        pwaNotificationCard.style.borderColor = "#cbd5e1";
        pwaNotificationCard.style.background = "#f1f5f9";
        if (cardTitle) cardTitle.textContent = "Notificaciones Web Push";
        if (cardText) cardText.textContent = "Para recibir actualizaciones de asistencia, abre esta aplicación desde la pantalla de inicio.";
        if (btnEnable) btnEnable.style.display = "none";
        if (btnDismiss) {
            btnDismiss.style.display = "";
            btnDismiss.textContent = "Cerrar";
        }
        setSectionVisible(pwaNotificationCard, true);
        return;
    }

    // 3. Validar VAPID
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.trim() === "") {
        setSectionVisible(pwaNotificationCard, false);
        return;
    }

    // 4. Obtener permiso de forma inmediata
    const permission = Notification.permission;

    // ESTADO A: Default y sin suscripción (Se ejecuta de forma síncrona sin awaits)
    if (permission === "default") {
        // Cooldown de 7 días
        const dismissedAt = localStorage.getItem("asistia_staff_push_dismissed_at");
        if (dismissedAt) {
            const diff = Date.now() - Number(dismissedAt);
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            if (diff < sevenDaysMs) {
                setSectionVisible(pwaNotificationCard, false);
                return;
            }
        }

        if (cardTitle) cardTitle.textContent = "Activa las notificaciones";
        if (cardText) cardText.textContent = "Recibe el resumen de asistencia y actualizaciones de la jornada.";
        if (btnEnable) {
            btnEnable.textContent = "Activar notificaciones";
            btnEnable.style.display = "";
            btnEnable.disabled = false;
        }
        if (btnDismiss) {
            btnDismiss.textContent = "Ahora no";
            btnDismiss.style.display = "";
            btnDismiss.disabled = false;
        }
        setSectionVisible(pwaNotificationCard, true);
        return;
    }

    // ESTADO D: Denegado (Se ejecuta de forma síncrona sin awaits)
    if (permission === "denied") {
        pwaNotificationCard.style.borderColor = "#f87171";
        pwaNotificationCard.style.background = "#fef2f2";
        if (cardTitle) cardTitle.textContent = "Notificaciones bloqueadas";
        if (cardText) cardText.textContent = "Las notificaciones están bloqueadas en este dispositivo. Puedes activarlas desde Configuración > Notificaciones > Staff.";
        if (btnEnable) btnEnable.style.display = "none";
        if (btnDismiss) {
            btnDismiss.style.display = "";
            btnDismiss.textContent = "Cerrar";
            btnDismiss.disabled = false;
        }
        setSectionVisible(pwaNotificationCard, true);
        return;
    }

    // ESTADO B/C: Concedido (Requiere consultar el Service Worker de forma asíncrona)
    if (permission === "granted") {
        setSectionVisible(pwaNotificationCard, false); // Ocultar preventivamente para evitar parpadeos de carga

        try {
            const swReadyPromise = navigator.serviceWorker.ready;
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Tiempo de espera agotado esperando al Service Worker.")), 5000)
            );
            const registration = await Promise.race([swReadyPromise, timeoutPromise]);
            const subscription = await registration.pushManager.getSubscription();

            if (subscription) {
                // ESTADO B: Concedido y existe PushSubscription
                pwaNotificationCard.style.borderColor = "#22c55e";
                pwaNotificationCard.style.background = "#f0fdf4";
                if (cardTitle) cardTitle.innerHTML = "✓ Notificaciones activadas";
                if (cardText) cardText.textContent = "Tu dispositivo está listo para recibir las actualizaciones de asistencia.";
                if (btnEnable) btnEnable.style.display = "none";
                if (btnDismiss) btnDismiss.style.display = "none";
                setSectionVisible(pwaNotificationCard, true);
            } else {
                // ESTADO C: Concedido pero sin PushSubscription
                pwaNotificationCard.style.borderColor = "#f59e0b";
                pwaNotificationCard.style.background = "#fffbeb";
                if (cardTitle) cardTitle.textContent = "Completa la activación";
                if (cardText) cardText.textContent = "Tu permiso está concedido. Completa el registro para recibir alertas.";
                if (btnEnable) {
                    btnEnable.textContent = "Completar activación";
                    btnEnable.style.display = "";
                    btnEnable.disabled = false;
                }
                if (btnDismiss) {
                    btnDismiss.style.display = "";
                    btnDismiss.textContent = "Ahora no";
                    btnDismiss.disabled = false;
                }
                setSectionVisible(pwaNotificationCard, true);
            }
        } catch (e) {
            console.warn("[push] Error al actualizar estado de notificaciones (granted):", e);
            if (pwaNotificationCard) {
                pwaNotificationCard.style.borderColor = "#ef4444";
                pwaNotificationCard.style.background = "#fef2f2";
                if (cardTitle) cardTitle.textContent = "No se pudo verificar el estado de las notificaciones.";
                if (cardText) cardText.textContent = "Intenta nuevamente.";
                if (btnEnable) {
                    btnEnable.textContent = "Reintentar";
                    btnEnable.style.display = "";
                    btnEnable.disabled = false;
                }
                if (btnDismiss) {
                    btnDismiss.textContent = "Cerrar";
                    btnDismiss.style.display = "";
                    btnDismiss.disabled = false;
                }
                setSectionVisible(pwaNotificationCard, true);
            }
        }
    }
}

async function registrarSuscripcionPushEnServidor(subscription) {
    if (!supabaseClient) throw new Error("Cliente de base de datos no inicializado.");

    const rawKey = subscription.getKey ? subscription.getKey('p256dh') : null;
    const rawAuth = subscription.getKey ? subscription.getKey('auth') : null;

    const p256dh = rawKey ? btoa(String.fromCharCode.apply(null, new Uint8Array(rawKey))) : "";
    const auth = rawAuth ? btoa(String.fromCharCode.apply(null, new Uint8Array(rawAuth))) : "";

    const { data, error } = await supabaseClient.rpc("rpc_registrar_suscripcion_push", {
        p_tenant_id: tenantActivoId,
        p_staff_id: staffSeleccionado.id,
        p_device_id: getDeviceId(),
        p_endpoint: subscription.endpoint,
        p_p256dh: p256dh,
        p_auth: auth
    });

    if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Error al registrar suscripción.");
    }
    return data;
}

async function activarFlujoNotificacionesPush() {
    if (!pwaNotificationCard) return;

    const btnEnable = document.getElementById("btnEnableNotifications");
    const btnDismiss = document.getElementById("btnDismissNotifications");
    const cardTitle = pwaNotificationCard.querySelector("h4");
    const cardText = pwaNotificationCard.querySelector("p");

    if (btnEnable && btnEnable.textContent === "Reintentar") {
        if (btnEnable) btnEnable.disabled = true;
        if (btnDismiss) btnDismiss.disabled = true;
        if (cardText) cardText.textContent = "Verificando estado de notificaciones...";
        try {
            await actualizarEstadoNotificacionesStaff();
        } catch (e) {
            console.warn(e);
        } finally {
            if (btnEnable) btnEnable.disabled = false;
            if (btnDismiss) btnDismiss.disabled = false;
        }
        return;
    }

    if (btnEnable) btnEnable.disabled = true;
    if (btnDismiss) btnDismiss.disabled = true;
    if (cardText) cardText.textContent = "Solicitando permisos al sistema...";

    try {
        if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.trim() === "") {
            throw new Error("Las notificaciones todavía no están configuradas en el servidor.");
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            throw new Error("Este navegador o dispositivo no soporta notificaciones Web Push.");
        }

        // 1. Solicitar permisos de notificación
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            throw new Error("Permiso de notificaciones denegado.");
        }

        if (cardText) cardText.textContent = "Generando suscripción segura...";

        // 2. Obtener el Service Worker listo
        const registration = await navigator.serviceWorker.ready;

        // 3. Suscribirse
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        if (cardText) cardText.textContent = "Registrando en el servidor...";

        // 4. Registrar en Supabase
        await registrarSuscripcionPushEnServidor(subscription);

        // 5. Éxito
        if (pwaNotificationCard) {
            pwaNotificationCard.style.borderColor = "#22c55e";
            pwaNotificationCard.style.background = "#f0fdf4";
        }
        if (cardTitle) cardTitle.innerHTML = "✓ Notificaciones activadas";
        if (cardText) cardText.textContent = "Tu dispositivo está listo para recibir las actualizaciones de asistencia.";
        if (btnEnable) btnEnable.style.display = "none";
        if (btnDismiss) btnDismiss.style.display = "none";

        // Programar el reset final de la asistencia si estamos en la vista de éxito
        if (staffCurrentView === "exito") {
            setTimeout(() => {
                resetStaffSeleccionado();
            }, 2500);
        } else {
            // Si estamos en perfil, refrescamos el estado visual de la tarjeta
            setTimeout(() => {
                actualizarEstadoNotificacionesStaff();
            }, 2500);
        }

    } catch (err) {
        console.error("[push] Error al activar notificaciones:", err);
        if (pwaNotificationCard) {
            pwaNotificationCard.style.borderColor = "#ef4444";
            pwaNotificationCard.style.background = "#fef2f2";
        }
        if (cardTitle) cardTitle.textContent = "No se pudieron activar las notificaciones";
        if (cardText) cardText.textContent = err.message || "Ocurrió un error inesperado.";
        if (btnEnable) btnEnable.style.display = "none";
        if (btnDismiss) {
            btnDismiss.disabled = false;
            btnDismiss.textContent = "Cerrar";
        }
    }
}

function descartarNotificacionesPush() {
    if (Notification.permission === "default") {
        localStorage.setItem("asistia_staff_push_dismissed_at", String(Date.now()));
    }
    setSectionVisible(pwaNotificationCard, false);

    if (staffCurrentView === "exito") {
        resetStaffSeleccionado();
    }
}

function haySupabase() {
    return !!supabaseClient
}

function enlazarIds() {
    tenantLabel = document.getElementById("tenantLabel")
    codigoBomberoInput = document.getElementById("codigoBomberoInput")
    staffLookupSection = document.getElementById("staffLookupSection")
    staffCardSection = document.getElementById("staffCardSection")
    staffSuccessSection = document.getElementById("staffSuccessSection")
    mensaje = document.getElementById("mensaje")
    staffProfileModal = document.getElementById("staffProfileModal")
    // Elementos PWA y cursos
    courseSelectorSection = document.getElementById("courseSelectorSection")
    courseListContainer = document.getElementById("courseListContainer")
    pwaInstallInviteModal = document.getElementById("pwaInstallInviteModal")
    pwaIosGuideModal = document.getElementById("pwaIosGuideModal")
    // Elementos Push
    pwaNotificationCard = document.getElementById("pwaNotificationCard")
    btnEnableNotifications = document.getElementById("btnEnableNotifications")
    btnDismissNotifications = document.getElementById("btnDismissNotifications")
}

function setMensaje(texto, tipo = "") {
    if (!mensaje) return
    mensaje.className = "message-box"
    mensaje.innerText = texto || ""
    if (texto && tipo) mensaje.classList.add(tipo)
}

function esErrorConexion(error) {
    const texto = String(error?.message || error || "").toLowerCase()
    return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|temporarily unavailable|connection|offline/i.test(texto)
}

function mensajeAmigableStaff(error, fallback = "Ocurrió un problema al procesar la solicitud.") {
    if (esErrorConexion(error)) return "No se pudo conectar con asistIA. Verifica tu conexión e inténtalo nuevamente."
    if (/auth|jwt|session/i.test(String(error?.message || error || ""))) return "La sesión expiró. Vuelve a iniciar sesión."
    return fallback
}

function actualizarDisponibilidadIngresoStaff() {
    const disabled = !cursoContextoValido
    if (codigoBomberoInput) codigoBomberoInput.disabled = disabled
    const btnBuscar = getBuscarStaffButton()
    if (btnBuscar) btnBuscar.disabled = disabled
}

function detectarTenantDesdeRuta() {
    const segments = String(window.location.pathname || "").split("/").filter(Boolean)
    const idxStaff = segments.indexOf("staff-asistencia")
    if (idxStaff > 0) {
        return String(segments[idxStaff - 1] || "").trim().toLowerCase()
    }
    if (segments[0] && segments[0] !== "staff-asistencia") {
        return String(segments[0] || "").trim().toLowerCase()
    }
    const params = new URLSearchParams(window.location.search || "")
    return String(params.get("tenant") || "").trim().toLowerCase()
}

function aplicarTenantEnUI() {
    const label = tenantActivoId ? String(tenantActivoId).toUpperCase() : "INSTITUCIÓN"
    if (tenantLabel) tenantLabel.textContent = label
    document.title = tenantActivoId ? `${tenantActivoId} - asistIA Staff` : "asistIA Staff"
}

function normalizarCodigoBombero(valor) {
    return String(valor || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)
}

function normalizarTexto(valor) {
    return String(valor || "").trim()
}

function normalizarCelular(valor) {
    return String(valor || "").replace(/\D/g, "")
}

function normalizarCorreo(valor) {
    return String(valor || "").trim().toLowerCase()
}

function esCorreoValido(valor) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor || ""))
}

function esCelularValido(valor) {
    const limpio = normalizarCelular(valor)
    return !limpio || (limpio.length >= 7 && limpio.length <= 15)
}

function sanitizeFileName(nombre) {
    return String(nombre || "foto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

function getDeviceId() {
    const key = "asistia_staff_device_id_v1"
    let id = localStorage.getItem(key)
    if (!id) {
        id = `staff-dev-${Math.random().toString(36).slice(2, 12)}`
        localStorage.setItem(key, id)
    }
    return id
}

function obtenerInicialesStaff(row) {
    const nombre = `${normalizarTexto(row?.nombres)} ${normalizarTexto(row?.apellidos)}`.replace(/\s+/g, " ").trim()
    if (!nombre) return "ST"
    return nombre
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0] || "")
        .join("")
        .toUpperCase()
}

function renderStaffAvatar(row) {
    const foto = normalizarTexto(row?.foto_url)
    const nombre = `${normalizarTexto(row?.nombres)} ${normalizarTexto(row?.apellidos)}`.trim() || "Staff"
    if (foto) {
        return `<img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}" class="staff-avatar">`
    }
    return `<span class="staff-avatar-placeholder" aria-hidden="true">${escapeHtml(obtenerInicialesStaff(row))}</span>`
}

function renderStaffCard(row) {
    if (!staffCardSection) return
    const nombre = `${normalizarTexto(row?.nombres)} ${normalizarTexto(row?.apellidos)}`.replace(/\s+/g, " ").trim()
    const tipo = normalizarTexto(row?.tipo_staff).toUpperCase() || "APOYO"
    let badgeClass = "apoyo"
    if (tipo === "ADJUNTO") {
        badgeClass = "adjunto"
    } else if (tipo === "INSTRUCTOR ESBAS") {
        badgeClass = "instructor"
    }
    const grado = normalizarTexto(row?.grado) || "Sin grado"
    const codigo = normalizarTexto(row?.codigo_bombero) || "-"
    const ubo = normalizarTexto(row?.ubo_origen) || "-"
    const celular = normalizarTexto(row?.celular) || "-"
    const correo = normalizarTexto(row?.correo) || "-"

    setSectionVisible(staffCardSection, true)
    staffCardSection.innerHTML = `
      <div class="staff-card-head">
        <div class="staff-avatar-shell">
          ${renderStaffAvatar(row)}
        </div>
        <div class="staff-card-copy">
          <p class="staff-card-meta">${escapeHtml(grado)}</p>
          <h2>${escapeHtml(nombre || "Staff")}</h2>
          <div class="staff-card-tags">
            <span class="staff-badge ${badgeClass}">${escapeHtml(tipo)}</span>
            <span class="staff-inline-code">CBP ${escapeHtml(codigo)}</span>
          </div>
        </div>
      </div>

      <div class="staff-card-fields">
        <div class="staff-field staff-field-primary"><strong>Código de Bombero</strong><span>${escapeHtml(codigo)}</span></div>
        <div class="staff-field"><strong>UBO origen</strong><span>${escapeHtml(ubo)}</span></div>
        <div class="staff-field"><strong>Celular</strong><span>${escapeHtml(celular)}</span></div>
        <div class="staff-field"><strong>Correo</strong><span>${escapeHtml(correo)}</span></div>
      </div>

      <div class="staff-card-actions">
        <button id="btnRegistrarStaff" class="primary-btn" type="button">Registrar asistencia</button>
        <button id="btnEditarPerfilStaff" class="secondary-btn" type="button">Editar perfil</button>
        <button id="btnResetStaff" class="tertiary-btn staff-card-cancel" type="button">Cancelar</button>
      </div>
    `
}

function setPerfilMsg(texto, tipo = "") {
    const el = document.getElementById("staffProfileMsg")
    if (!el) return
    el.className = "inline-form-msg"
    el.textContent = texto || ""
    if (texto && tipo) el.classList.add(tipo)
}

function toggleEdicionPerfilStaff() {
    staffPerfilEditando = !staffPerfilEditando
    setPerfilMsg("")
    renderStaffCard(staffSeleccionado)
}

function cancelarEdicionPerfilStaff() {
    if (staffPerfilGuardando) return
    staffPerfilEditando = false
    staffPerfilGuardando = false
    cerrarModalPerfilStaff()
}

function renderPreviewFotoModalStaff(row) {
    const preview = document.getElementById("staffPhotoPreview")
    if (!preview) return
    const nombre = `${normalizarTexto(row?.nombres)} ${normalizarTexto(row?.apellidos)}`.trim() || "Staff"
    const foto = normalizarTexto(row?.foto_url)
    preview.innerHTML = foto
        ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}" class="staff-photo-preview-img">`
        : `<div class="staff-photo-preview-empty">${escapeHtml(obtenerInicialesStaff(row))}</div>`
}

function actualizarEstadoModalPerfilStaff() {
    const btnGuardar = document.getElementById("btnGuardarPerfilStaff")
    const btnCancelar = document.getElementById("btnCancelarPerfilStaff")
    if (btnGuardar) {
        btnGuardar.disabled = !!staffPerfilGuardando
        btnGuardar.textContent = staffPerfilGuardando ? "Guardando..." : "Guardar cambios"
    }
    if (btnCancelar) btnCancelar.disabled = !!staffPerfilGuardando
}

function abrirModalPerfilStaff() {
    if (!staffProfileModal || !staffSeleccionado) return
    const celularInput = document.getElementById("staffPerfilCelular")
    const correoInput = document.getElementById("staffPerfilCorreo")
    const fotoInput = document.getElementById("staffFotoFile")
    staffPerfilEditando = true
    setStaffView("editar")
    staffProfileModal.setAttribute("aria-hidden", "false")
    document.body.classList.add("staff-modal-open")
    if (celularInput) celularInput.value = normalizarTexto(staffSeleccionado?.celular)
    if (correoInput) correoInput.value = normalizarTexto(staffSeleccionado?.correo)
    if (fotoInput) fotoInput.value = ""
    renderPreviewFotoModalStaff(staffSeleccionado)
    setPerfilMsg("")
    actualizarEstadoModalPerfilStaff()
    celularInput?.focus()
}

function cerrarModalPerfilStaff() {
    if (!staffProfileModal) return
    staffPerfilEditando = false
    staffPerfilGuardando = false
    setSectionVisible(staffProfileModal, false)
    staffProfileModal.setAttribute("aria-hidden", "true")
    document.body.classList.remove("staff-modal-open")
    setPerfilMsg("")
    actualizarEstadoModalPerfilStaff()
    if (staffSeleccionado && staffCurrentView !== "exito") {
        setStaffView("perfil")
    }
}

function obtenerArchivoFotoStaffValido() {
    const input = document.getElementById("staffFotoFile")
    const file = input?.files?.[0] || null
    if (!file) return { ok: true, file: null }

    const tiposPermitidos = ["image/jpeg", "image/png", "image/webp"]
    if (!tiposPermitidos.includes(file.type)) {
        return { ok: false, mensaje: "La foto debe ser JPG, PNG o WEBP." }
    }
    if (file.size > 2 * 1024 * 1024) {
        return { ok: false, mensaje: "La foto excede el máximo permitido de 2 MB." }
    }
    return { ok: true, file }
}

async function subirFotoStaff(file) {
    const bucket = "staff-fotos"
    const codigo = normalizarCodigoBombero(staffSeleccionado?.codigo_bombero)
    const tenant = normalizarTexto(tenantActivoId)
    const timestamp = Date.now()
    const nombre = sanitizeFileName(file?.name || "foto_staff")
    const path = `${tenant}/${codigo}/${timestamp}_${nombre}`

    const { error: uploadError } = await supabaseClient.storage
        .from(bucket)
        .upload(path, file, {
            cacheControl: "3600",
            upsert: false
        })

    if (uploadError) {
        console.error("Error subiendo foto staff:", uploadError)
        throw new Error(
            /bucket/i.test(String(uploadError.message || ""))
                ? "No se pudo cargar la información."
                : mensajeAmigableStaff(uploadError, "Ocurrió un problema al procesar la solicitud.")
        )
    }

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path)
    const publicUrl = normalizarTexto(data?.publicUrl)
    if (!publicUrl) {
        throw new Error("No se pudo cargar la información.")
    }
    return publicUrl
}

async function guardarPerfilStaff(event) {
    event?.preventDefault()
    if (!staffSeleccionado?.id || !tenantActivoId || !haySupabase()) {
        setPerfilMsg("No se pudo preparar la edición del perfil.", "error")
        return
    }

    const celularInput = document.getElementById("staffPerfilCelular")
    const correoInput = document.getElementById("staffPerfilCorreo")
    const celular = normalizarCelular(celularInput?.value)
    const correo = normalizarCorreo(correoInput?.value)
    const validacionFoto = obtenerArchivoFotoStaffValido()

    if (celularInput) celularInput.value = celular
    if (correoInput) correoInput.value = correo

    if (!esCelularValido(celular)) {
        setPerfilMsg("El celular debe contener solo números y tener entre 7 y 15 dígitos.", "error")
        return
    }
    if (correo && !esCorreoValido(correo)) {
        setPerfilMsg("Ingresa un correo válido.", "error")
        return
    }
    if (!validacionFoto.ok) {
        setPerfilMsg(validacionFoto.mensaje, "error")
        return
    }

    staffPerfilGuardando = true
    actualizarEstadoModalPerfilStaff()
    setPerfilMsg("Guardando cambios...", "ok")

    try {
        let fotoUrl = normalizarTexto(staffSeleccionado?.foto_url) || null
        if (validacionFoto.file) {
            fotoUrl = await subirFotoStaff(validacionFoto.file)
        }

        const payload = {
            foto_url: fotoUrl,
            celular: celular || null,
            correo: correo || null
        }

        const { data, error } = await supabaseClient
            .from("staff_instruccion")
            .update(payload)
            .eq("id", staffSeleccionado.id)
            .eq("tenant_id", tenantActivoId)
            .eq("codigo_bombero", normalizarCodigoBombero(staffSeleccionado.codigo_bombero))
            .eq("activo", true)
            .select("*")
            .maybeSingle()

        if (error) {
            console.error("Error actualizando perfil staff:", error)
            throw new Error(
                /policy|rls|permission|row-level/i.test(String(error.message || ""))
                    ? "Ocurrió un problema al procesar la solicitud."
                    : mensajeAmigableStaff(error, "Ocurrió un problema al procesar la solicitud.")
            )
        }
        if (!data?.id) {
            throw new Error("No se pudo cargar la información.")
        }

        staffSeleccionado = {
            ...staffSeleccionado,
            ...data
        }
        staffPerfilGuardando = false
        renderStaffCard(staffSeleccionado)
        renderPreviewFotoModalStaff(staffSeleccionado)
        cerrarModalPerfilStaff()
        setMensaje("Perfil actualizado correctamente.", "ok")
    } catch (error) {
        console.error("Error guardando perfil staff:", error)
        staffPerfilGuardando = false
        actualizarEstadoModalPerfilStaff()
        setPerfilMsg(mensajeAmigableStaff(error, "Ocurrió un problema al procesar la solicitud."), "error")
    }
}

function resetStaffSeleccionado() {
    staffSeleccionado = null
    staffPerfilEditando = false
    staffPerfilGuardando = false
    staffCurrentView = "login"
    document.body.classList.remove("staff-modal-open")
    setSectionVisible(staffProfileModal, false)
    if (staffProfileModal) staffProfileModal.setAttribute("aria-hidden", "true")
    if (staffCardSection) {
        setSectionVisible(staffCardSection, false)
        staffCardSection.innerHTML = ""
    }
    if (staffSuccessSection) {
        setSectionVisible(staffSuccessSection, false)
        staffSuccessSection.innerHTML = ""
    }
    if (staffLookupSection) {
        setSectionVisible(staffLookupSection, true)
        staffLookupSection.classList.remove("is-collapsed")
    }
    if (codigoBomberoInput) {
        codigoBomberoInput.value = ""
        codigoBomberoInput.focus()
    }
    setPerfilMsg("")
    setStaffView("login")
}

function obtenerCursoTokenDesdeURL() {
    try {
        const params = new URLSearchParams(window.location.search || "")
        return String(params.get("curso") || "").trim()
    } catch (e) {
        return ""
    }
}

async function resolverCursoPorId(cursoId) {
    cursoActualId = null
    if (!cursoId || !haySupabase() || !tenantActivoId) {
        cursoContextoValido = false
        return false
    }

    const { data, error } = await withTenantScope(
        supabaseClient
            .from("cursos")
            .select("id, estado")
    )
        .eq("id", cursoId)
        .eq("estado", "activo")
        .limit(1)

    if (error) {
        cursoContextoValido = false
        return false
    }

    const row = Array.isArray(data) ? data[0] : null
    if (!row?.id) {
        cursoContextoValido = false
        return false
    }

    cursoActualId = Number(row.id) || null
    cursoContextoValido = !!cursoActualId
    return !!cursoActualId
}

function withTenantScope(query) {
    if (!tenantActivoId) return query
    return query.eq("tenant_id", tenantActivoId)
}

async function resolverCursoContexto() {
    const token = obtenerCursoTokenDesdeURL()
    cursoActualId = null
    cursoContextoValido = false

    if (!tenantActivoId || !haySupabase()) return false

    // 1. Si hay token en la URL (QR)
    if (token) {
        if (/^\d+$/.test(token)) {
            return resolverCursoPorId(Number(token))
        }

        try {
            const { data, error } = await supabaseClient.rpc("rpc_validar_curso_qr", {
                p_qr_token: token,
                p_tenant_id: tenantActivoId
            })

            if (error || !data?.success) {
                cursoContextoValido = false
                cursoActualId = null
                return false
            }

            cursoActualId = Number(data.curso_id || 0) || null
            cursoContextoValido = !!cursoActualId

            if (cursoActualId) {
                localStorage.setItem("asistia_staff_pref_curso_id", String(cursoActualId))
            }
            return !!cursoActualId
        } catch (e) {
            cursoContextoValido = false
            cursoActualId = null
            return false
        }
    }

    // 2. Si se abre desde el icono (sin token en la URL)
    try {
        const { data, error } = await supabaseClient
            .from("cursos")
            .select("id, nombre, estado")
            .eq("tenant_id", tenantActivoId)
            .eq("estado", "activo")

        if (error || !data || data.length === 0) {
            cursoContextoValido = false
            return false
        }

        if (data.length === 1) {
            cursoActualId = Number(data[0].id) || null
            cursoContextoValido = !!cursoActualId
            return !!cursoActualId
        } else {
            const prefCursoId = Number(localStorage.getItem("asistia_staff_pref_curso_id"))
            const cursoPrefValido = data.find(c => Number(c.id) === prefCursoId)

            return { requiereSeleccion: true, cursos: data, sugerido: cursoPrefValido }
        }
    } catch (e) {
        console.error("Error al resolver cursos activos:", e)
        cursoContextoValido = false
        return false
    }
}

function mostrarSelectorDeCurso(cursos, sugerido) {
    setStaffView("login")
    setSectionVisible(staffLookupSection, false)
    setSectionVisible(courseSelectorSection, true)

    if (courseListContainer) {
        courseListContainer.innerHTML = ""
        cursos.forEach(curso => {
            const btn = document.createElement("button")
            btn.type = "button"
            btn.className = "primary-btn"
            btn.style.width = "100%"
            btn.style.textAlign = "left"
            btn.style.display = "flex"
            btn.style.justifyContent = "space-between"
            btn.style.alignItems = "center"
            btn.style.padding = "14px 16px"
            btn.style.background = "#ffffff"
            btn.style.color = "#1e293b"
            btn.style.border = "1px solid #cbd5e1"
            btn.style.borderRadius = "12px"
            btn.style.boxShadow = "none"
            btn.style.cursor = "pointer"
            btn.style.transition = "all 0.15s ease"
            btn.style.marginBottom = "8px"

            const esSugerido = sugerido && Number(sugerido.id) === Number(curso.id)
            btn.innerHTML = `
                <span style="font-weight: 500; font-family: Sora, sans-serif;">${escapeHtml(curso.nombre || "Curso")}</span>
                ${esSugerido ? '<span style="font-size: 0.75rem; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 999px; font-weight: 600;">Sugerido</span>' : ''}
            `

            btn.addEventListener("mouseenter", () => {
                btn.style.borderColor = "#2563eb"
                btn.style.background = "#eff6ff"
            })
            btn.addEventListener("mouseleave", () => {
                btn.style.borderColor = esSugerido ? "#2563eb" : "#cbd5e1"
                btn.style.background = "#ffffff"
            })

            if (esSugerido) {
                btn.style.borderColor = "#2563eb"
                btn.style.background = "#f8fafc"
            }

            btn.addEventListener("click", () => {
                seleccionarCursoDeSelector(curso.id)
            })
            courseListContainer.appendChild(btn)
        })
    }
}

function seleccionarCursoDeSelector(cursoId) {
    cursoActualId = Number(cursoId) || null
    cursoContextoValido = !!cursoActualId
    localStorage.setItem("asistia_staff_pref_curso_id", String(cursoId))

    setSectionVisible(courseSelectorSection, false)
    setSectionVisible(staffLookupSection, true)
    actualizarDisponibilidadIngresoStaff()
    setMensaje("")

    if (codigoBomberoInput) {
        codigoBomberoInput.focus()
    }
}

function obtenerFechaHoraLima(fechaBase = new Date()) {
    const dtf = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    })

    const parts = Object.fromEntries(
        dtf.formatToParts(fechaBase)
            .filter(part => part.type !== "literal")
            .map(part => [part.type, part.value])
    )

    return {
        fecha: `${parts.year}-${parts.month}-${parts.day}`,
        hora: `${parts.hour}:${parts.minute}:${parts.second}`,
        weekday: new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Lima",
            weekday: "long"
        }).format(fechaBase).toLowerCase()
    }
}

function obtenerJornadaStaff(weekday) {
    if (weekday === "tuesday" || weekday === "thursday") return "SECCION"
    if (weekday === "sunday") return "DOMINICAL"
    return "GENERAL"
}

async function buscarStaffPorCodigo() {
    const codigo = normalizarCodigoBombero(codigoBomberoInput?.value)
    if (codigoBomberoInput) codigoBomberoInput.value = codigo

    if (!codigo) {
        setMensaje("Ingresa tu Código CBP.", "error")
        return
    }
    if (!tenantActivoId) {
        setMensaje("No se pudo identificar la institución.", "error")
        return
    }
    if (!haySupabase()) {
        setMensaje("No se pudo iniciar la conexión con el servidor.", "error")
        return
    }
    if (!cursoContextoValido) {
        setMensaje("El curso indicado no es válido para esta institución.", "error")
        return
    }
    if (!cursoActualId) {
        setMensaje("No se pudo resolver el curso del QR actual. Intenta escanear nuevamente el QR oficial.", "error")
        return
    }

    let data = null
    try {
        const response = await supabaseClient
            .from("staff_instruccion")
            .select("*")
            .eq("tenant_id", tenantActivoId)
            .eq("curso_id", cursoActualId)
            .eq("codigo_bombero", codigo)
            .eq("activo", true)
            .maybeSingle()
        data = response.data
        if (response.error) {
            console.error("Error validando staff por código:", response.error)
            setMensaje(
                /does not exist|42P01/i.test(String(response.error.message || ""))
                    ? "No se pudo cargar la información."
                    : mensajeAmigableStaff(response.error, "No se pudo cargar la información."),
                "error"
            )
            return
        }
    } catch (error) {
        console.error("Error inesperado validando staff:", error)
        setMensaje(mensajeAmigableStaff(error, "No se pudo cargar la información."), "error")
        return
    }

    if (!data) {
        staffSeleccionado = null
        staffPerfilEditando = false
        staffPerfilGuardando = false
        if (staffCardSection) {
            setSectionVisible(staffCardSection, false)
            staffCardSection.innerHTML = ""
        }
        setStaffView("login", { preserveMessage: true })
        setMensaje("No existe un staff activo con ese Código de Bombero.", "warning")
        return
    }

    staffSeleccionado = data
    staffPerfilEditando = false
    staffPerfilGuardando = false
    renderStaffCard(data)
    setStaffView("perfil")
    setMensaje("")

    // Verificar si ya registró asistencia hoy para habilitar el flujo de notificaciones
    const lima = obtenerFechaHoraLima(new Date())
    try {
        const { data: existente, error: errorConsulta } = await supabaseClient
            .from("staff_asistencias")
            .select("id")
            .eq("tenant_id", tenantActivoId)
            .eq("staff_id", data.id)
            .eq("fecha", lima.fecha)
            .maybeSingle()

        if (!errorConsulta && existente?.id) {
            setMensaje("Ya registraste asistencia staff hoy.", "warning")
            void actualizarEstadoNotificacionesStaff()
        } else {
            setSectionVisible(pwaNotificationCard, false);
        }
    } catch (e) {
        console.error("Error al consultar asistencia del día:", e)
    }
}

async function registrarAsistenciaStaff() {
    if (!staffSeleccionado || !tenantActivoId) {
        setMensaje("Primero valida un Código de Bombero.", "error")
        return
    }
    if (!cursoContextoValido) {
        setMensaje("El curso indicado no es válido para esta institución.", "error")
        return
    }

    const lima = obtenerFechaHoraLima(new Date())
    const nombreCompleto = `${normalizarTexto(staffSeleccionado.nombres)} ${normalizarTexto(staffSeleccionado.apellidos)}`.replace(/\s+/g, " ").trim()
    const payload = {
        tenant_id: tenantActivoId,
        curso_id: cursoActualId,
        staff_id: staffSeleccionado.id,
        codigo_bombero: normalizarCodigoBombero(staffSeleccionado.codigo_bombero),
        nombre: nombreCompleto,
        grado: normalizarTexto(staffSeleccionado.grado) || null,
        ubo_origen: normalizarTexto(staffSeleccionado.ubo_origen) || null,
        tipo_staff: normalizarTexto(staffSeleccionado.tipo_staff).toUpperCase() || "APOYO",
        fecha: lima.fecha,
        hora_ingreso: lima.hora,
        jornada: obtenerJornadaStaff(lima.weekday),
        origen_registro: "qr_staff",
        device_id: getDeviceId()
    }

    try {
        const { data: existente, error: errorConsulta } = await supabaseClient
            .from("staff_asistencias")
            .select("id")
            .eq("tenant_id", tenantActivoId)
            .eq("staff_id", staffSeleccionado.id)
            .eq("fecha", lima.fecha)
            .maybeSingle()

        if (errorConsulta && !/0 rows/i.test(String(errorConsulta.message || ""))) {
            console.error("Error validando duplicados staff:", errorConsulta)
            setMensaje(mensajeAmigableStaff(errorConsulta, "No se pudo cargar la información."), "error")
            return
        }

        if (existente?.id) {
            setMensaje("Ya registraste asistencia staff hoy.", "warning")
            void actualizarEstadoNotificacionesStaff()
            return
        }

        const { error } = await supabaseClient
            .from("staff_asistencias")
            .insert([payload])

        if (error) {
            if (/duplicate key|23505/i.test(String(error.message || ""))) {
                setMensaje("Ya registraste asistencia staff hoy.", "warning")
                void actualizarEstadoNotificacionesStaff()
                return
            }
            console.error("Error registrando asistencia staff:", error)
            setMensaje(mensajeAmigableStaff(error, "Ocurrió un problema al procesar la solicitud."), "error")
            return
        }
    } catch (error) {
        console.error("Error inesperado en asistencia staff:", error)
        setMensaje(mensajeAmigableStaff(error, "Ocurrió un problema al procesar la solicitud."), "error")
        return
    }

    setStaffView("exito", {
        hora: lima.hora,
        tipo_staff: payload.tipo_staff,
        nombres: staffSeleccionado.nombres,
        apellidos: staffSeleccionado.apellidos
    })
    setMensaje("")
}

function bindEventos() {
    getBuscarStaffButton()?.addEventListener("click", buscarStaffPorCodigo)
    staffCardSection?.addEventListener("click", event => {
        const target = event.target.closest("button")
        if (!target) return
        if (target.id === "btnRegistrarStaff") registrarAsistenciaStaff()
        if (target.id === "btnResetStaff") resetStaffSeleccionado()
        if (target.id === "btnEditarPerfilStaff") abrirModalPerfilStaff()
    })
    codigoBomberoInput?.addEventListener("input", () => {
        if (codigoBomberoInput) codigoBomberoInput.value = normalizarCodigoBombero(codigoBomberoInput.value)
    })
    codigoBomberoInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") buscarStaffPorCodigo()
    })
    document.getElementById("staffProfileForm")?.addEventListener("submit", guardarPerfilStaff)
    document.getElementById("btnCancelarPerfilStaff")?.addEventListener("click", cancelarEdicionPerfilStaff)
    document.getElementById("btnCloseStaffModal")?.addEventListener("click", cancelarEdicionPerfilStaff)
    document.querySelector('[data-close-staff-modal="true"]')?.addEventListener("click", cancelarEdicionPerfilStaff)
    document.getElementById("staffPerfilCelular")?.addEventListener("input", () => {
        const input = document.getElementById("staffPerfilCelular")
        if (input) input.value = normalizarCelular(input.value)
    })

    // Eventos de PWA Invitación e Instalación
    document.getElementById("btnRejectInstallInvite")?.addEventListener("click", () => {
        localStorage.setItem("asistia_staff_install_dismissed_at", String(Date.now()));
        cerrarModalInstalacionPwa();
        resetStaffSeleccionado();
    });

    document.getElementById("btnDismissInstallInvite")?.addEventListener("click", () => {
        localStorage.setItem("asistia_staff_install_dismissed_at", String(Date.now()));
        cerrarModalInstalacionPwa();
        resetStaffSeleccionado();
    });

    document.getElementById("btnAcceptInstallInvite")?.addEventListener("click", async () => {
        if (deferredPrompt) {
            cerrarModalInstalacionPwa();
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`[staff] Resultado del prompt de instalación: ${outcome}`);
            deferredPrompt = null;
            resetStaffSeleccionado();
        } else {
            abrirGuiaManualInstalacion();
        }
    });

    // Eventos de Guía Manual iOS/Android
    document.getElementById("btnDismissIosGuide")?.addEventListener("click", () => {
        cerrarGuiaManualInstalacion();
        resetStaffSeleccionado();
    });

    document.getElementById("btnCloseIosGuide")?.addEventListener("click", () => {
        cerrarGuiaManualInstalacion();
        resetStaffSeleccionado();
    });

    document.getElementById("btnCloseIosGuideX")?.addEventListener("click", () => {
        cerrarGuiaManualInstalacion();
        resetStaffSeleccionado();
    });

    // Evento de soporte WhatsApp
    document.getElementById("btnSoporteWa")?.addEventListener("click", abrirWhatsAppSoporteStaff)

    // Eventos de activación de notificaciones Push
    document.getElementById("btnEnableNotifications")?.addEventListener("click", activarFlujoNotificacionesPush)
    document.getElementById("btnDismissNotifications")?.addEventListener("click", descartarNotificacionesPush)

    // Listener de teclado global (Escape)
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            if (staffProfileModal && !staffProfileModal.hidden) {
                cancelarEdicionPerfilStaff()
            } else if (pwaInstallInviteModal && !pwaInstallInviteModal.hidden) {
                cerrarModalInstalacionPwa()
                resetStaffSeleccionado()
            } else if (pwaIosGuideModal && !pwaIosGuideModal.hidden) {
                cerrarGuiaManualInstalacion()
                resetStaffSeleccionado()
            } else if (pwaNotificationCard && !pwaNotificationCard.hidden) {
                descartarNotificacionesPush()
            }
        }
    })
}
// ----------------------------------------------------
// SOPORTE Y REPORTE DE PROBLEMAS (WHATSAPP)
// ----------------------------------------------------
function detectarEstadoProblemaStaff() {
    const msgText = String(mensaje?.textContent || "").trim()
    let problema = "Consulta general staff"
    let prioridad = "BAJA"

    if (msgText.includes("no existe en el padrón") || msgText.includes("Código no encontrado")) {
        problema = "Código CBP no encontrado"
        prioridad = "ALTA"
        return { problema, prioridad }
    }
    if (msgText.includes("no hay jornada") || msgText.includes("no hay clase")) {
        problema = "Sin jornada activa para staff"
        prioridad = "ALTA"
        return { problema, prioridad }
    }
    if (msgText.includes("Error") || msgText.includes("falló") || msgText.includes("no se pudo")) {
        problema = "Error en registro de staff"
        prioridad = "ALTA"
        return { problema, prioridad }
    }

    return { problema, prioridad }
}

function generarMensajeWhatsAppStaff() {
    const codIdentificador = staffSeleccionado?.codigo_bombero || staffSeleccionado?.dni || String(codigoBomberoInput?.value || "").trim() || "SIN_CODIGO"
    const idReporte = generarIdReporteComun("STAFF", codIdentificador)
    const { problema, prioridad } = detectarEstadoProblemaStaff()

    const sCodigo = staffSeleccionado?.codigo_bombero || (codIdentificador !== "SIN_CODIGO" ? codIdentificador : "Datos aún no validados")
    const sNombreCompleto = staffSeleccionado ? `${staffSeleccionado.nombres || ""} ${staffSeleccionado.apellidos || ""}`.trim() : "Datos aún no validados"
    const sTipoStaff = staffSeleccionado?.tipo_staff || "No disponible"
    const sSeccion = staffSeleccionado?.seccion || "No disponible"
    const sCurso = cursoActualId ? String(cursoActualId) : "No disponible"
    const sInstitucion = String(tenantActivoId || "").trim().toUpperCase() || "No disponible"

    const vistaActual = staffCurrentView || "login"
    const errorVisible = String(mensaje?.textContent || "").trim() || "Ninguno"

    const fechaLocal = new Date().toLocaleDateString("es-PE")
    const horaLocal = new Date().toLocaleTimeString("es-PE")
    const appVersion = obtenerVersionAsistIA()

    return `ID reporte:
${idReporte}

Prioridad:
${prioridad}

Problema detectado:
- ${problema}

Contexto del módulo:
- Módulo: Staff Asistencia
- Vista actual: ${vistaActual}

Datos del staff:
- Código CBP/ID: ${sCodigo}
- Nombre completo: ${sNombreCompleto}
- Tipo staff: ${sTipoStaff}
- Sección: ${sSeccion}
- Curso: ${sCurso}
- Institución: ${sInstitucion}

Datos del registro/contexto:
- Mensaje visible: ${errorVisible}
- Fecha local: ${fechaLocal}
- Hora local: ${horaLocal}
- URL actual: ${window.location.href}
- Versión asistIA: ${appVersion}

${obtenerDatosDispositivoReporte()}

Texto editable para el usuario:
"Descripción del problema:
"

Desarrollado por Labs Projects`
}

function abrirWhatsAppSoporteStaff() {
    const text = generarMensajeWhatsAppStaff()
    abrirWhatsAppSoporteMensaje(text)
}

async function init() {
    enlazarIds()
    bindEventos()

    tenantActivoId = detectarTenantDesdeRuta()
    window.tenantActivoId = tenantActivoId
    aplicarTenantEnUI()

    if (!tenantActivoId) {
        setMensaje("No se pudo identificar la institución en la ruta.", "error")
        return
    }

    if (!haySupabase()) {
        setMensaje("No se pudo iniciar la conexión con el servidor.", "error")
        return
    }

    const resCurso = await resolverCursoContexto()
    if (resCurso && resCurso.requiereSeleccion) {
        mostrarSelectorDeCurso(resCurso.cursos, resCurso.sugerido)
        return
    }

    actualizarDisponibilidadIngresoStaff()

    if (!cursoContextoValido) {
        setMensaje("El curso indicado no es válido para esta institución.", "error")
    }
    setStaffView("login", { preserveMessage: !cursoContextoValido })
}

window.addEventListener("load", () => {
    void init()
})

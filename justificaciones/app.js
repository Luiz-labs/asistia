const supabaseUrl = "https://kcapmyovaigjntaqeqwn.supabase.co"
const supabaseKey = "sb_publishable_oObf3s5mQ4sfmJ03JKQrnQ__8Rmb63F"

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null

let tenantActivoId = ""
let cursoActualId = null
let cursoQRValido = false
let validacionDniAspirante = null
let fileSeleccionado = null
let configuracionOperativa = {
    plazoDias: 3,
    docObligatorio: true,
    maxSizeMb: 2.0,
    tiposPermitidos: "pdf,jpg,jpeg,png"
}
let db = null
let sincronizacionEnCurso = false

const OFFLINE_DB_NAME = "asistia_offline_db"
const OFFLINE_STORE_NAME = "justificaciones_queue"

// Enlazar elementos del DOM
let tenantLabel
let stepIngreso
let stepFecha
let stepSustento
let stepExito
let mobileDniInicio
let btnIngresarInicio
let studentDetailsCard
let fechaJustificar
let btnValidarFecha
let btnVolverPaso1
let summaryDni
let summaryFecha
let fileSustento
let fileMetaInfo
let fileName
let fileSize
let btnRegistrarJustificacion
let btnVolverPaso2
let btnNuevaJustificacion
let mensaje
let pendingCounter
let dropzoneLabel
let selectMotivo
let selectTipoSustento
let inputMotivoOtro
let inputSustentoOtro
let wrapperMotivoOtro
let wrapperSustentoOtro

function debugLog(...args) {
    console.log("[asistIA-justif-debug]", ...args)
}

function haySupabase() {
    return !!supabaseClient
}

function enlazarIds() {
    tenantLabel = document.getElementById("tenantLabel")
    stepIngreso = document.getElementById("stepIngreso")
    stepFecha = document.getElementById("stepFecha")
    stepSustento = document.getElementById("stepSustento")
    stepExito = document.getElementById("stepExito")
    mobileDniInicio = document.getElementById("mobileDniInicio")
    btnIngresarInicio = document.getElementById("btnIngresarInicio")
    studentDetailsCard = document.getElementById("studentDetailsCard")
    fechaJustificar = document.getElementById("fechaJustificar")
    btnValidarFecha = document.getElementById("btnValidarFecha")
    btnVolverPaso1 = document.getElementById("btnVolverPaso1")
    summaryDni = document.getElementById("summaryDni")
    summaryFecha = document.getElementById("summaryFecha")
    fileSustento = document.getElementById("fileSustento")
    fileMetaInfo = document.getElementById("fileMetaInfo")
    fileName = document.getElementById("fileName")
    fileSize = document.getElementById("fileSize")
    btnRegistrarJustificacion = document.getElementById("btnRegistrarJustificacion")
    btnVolverPaso2 = document.getElementById("btnVolverPaso2")
    btnNuevaJustificacion = document.getElementById("btnNuevaJustificacion")
    mensaje = document.getElementById("mensaje")
    pendingCounter = document.getElementById("pendingCounter")
    dropzoneLabel = document.getElementById("dropzoneLabel")
    selectMotivo = document.getElementById("selectMotivo")
    selectTipoSustento = document.getElementById("selectTipoSustento")
    inputMotivoOtro = document.getElementById("inputMotivoOtro")
    inputSustentoOtro = document.getElementById("inputSustentoOtro")
    wrapperMotivoOtro = document.getElementById("wrapperMotivoOtro")
    wrapperSustentoOtro = document.getElementById("wrapperSustentoOtro")
}

function setMensaje(texto, tipo = "") {
    if (!mensaje) return
    
    const enExito = stepExito && stepExito.style.display === "flex"
    if (enExito && tipo !== "error") {
        mensaje.innerText = ""
        mensaje.className = "message-box"
        return
    }

    mensaje.className = "message-box"
    mensaje.innerText = texto || ""
    if (!texto) return
    if (tipo) mensaje.classList.add(tipo)
}

function esErrorConexion(error) {
    const texto = String(error?.message || error || "").toLowerCase()
    return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|temporarily unavailable|connection|offline/i.test(texto)
}

function escapeHTML(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

const MOTIVOS_DEFAULT = [
    "Descanso médico",
    "Motivo académico",
    "Comisión de servicio",
    "Actividad bomberil",
    "Trabajo",
    "Viaje",
    "Otro"
]

const SUSTENTOS_DEFAULT = [
    "Certificado médico",
    "Constancia",
    "Oficio",
    "Memorando",
    "Documento institucional",
    "Declaración jurada",
    "Otro"
]

function inicializarCatalogos() {
    if (!selectMotivo || !selectTipoSustento) return

    let motivos = MOTIVOS_DEFAULT
    if (configuracionOperativa && configuracionOperativa.motivos && configuracionOperativa.motivos.trim()) {
        const splitMotivos = configuracionOperativa.motivos.split(",").map(x => x.trim()).filter(Boolean)
        if (splitMotivos.length > 0) {
            motivos = splitMotivos
        }
    }

    let sustentos = SUSTENTOS_DEFAULT
    if (configuracionOperativa && configuracionOperativa.tiposSustento && configuracionOperativa.tiposSustento.trim()) {
        const splitSustentos = configuracionOperativa.tiposSustento.split(",").map(x => x.trim()).filter(Boolean)
        if (splitSustentos.length > 0) {
            sustentos = splitSustentos
        }
    }

    selectMotivo.innerHTML = '<option value="">-- Seleccione un motivo --</option>'
    motivos.forEach(m => {
        selectMotivo.innerHTML += `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`
    })

    selectTipoSustento.innerHTML = '<option value="">-- Seleccione el tipo de sustento --</option>'
    sustentos.forEach(s => {
        selectTipoSustento.innerHTML += `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`
    })

    console.log("[JUSTIFICACIONES] catálogos cargados", {
        motivos: selectMotivo.options.length,
        sustentos: selectTipoSustento.options.length
    })
}

function asegurarCatalogosVisibles() {
    if (!selectMotivo || !selectTipoSustento) return

    const necesitaMotivos = !selectMotivo.options || selectMotivo.options.length <= 1
    const necesitaSustentos = !selectTipoSustento.options || selectTipoSustento.options.length <= 1

    if (necesitaMotivos) {
        debugLog("Catálogo de motivos vacío o incompleto. Repoblando con defaults.")
        selectMotivo.innerHTML = '<option value="">-- Seleccione un motivo --</option>'
        MOTIVOS_DEFAULT.forEach(m => {
            selectMotivo.innerHTML += `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`
        })
    }

    if (necesitaSustentos) {
        debugLog("Catálogo de sustentos vacío o incompleto. Repoblando con defaults.")
        selectTipoSustento.innerHTML = '<option value="">-- Seleccione el tipo de sustento --</option>'
        SUSTENTOS_DEFAULT.forEach(s => {
            selectTipoSustento.innerHTML += `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`
        })
    }

    console.log("[JUSTIFICACIONES] catálogos asegurados", {
        motivos: selectMotivo.options.length,
        sustentos: selectTipoSustento.options.length
    })
}

function getDeviceId() {
    let id = localStorage.getItem("dev")
    if (!id) {
        id = `dev-${Math.random().toString(36).slice(2, 12)}`
        localStorage.setItem("dev", id)
    }
    return id
}

function detectarTenantDesdeRuta() {
    const segments = String(window.location.pathname || "").split("/").filter(Boolean)
    const idxJustificaciones = segments.indexOf("justificaciones")
    if (idxJustificaciones > 0) {
        return String(segments[idxJustificaciones - 1] || "").trim().toLowerCase()
    }
    if (segments[0] && segments[0] !== "justificaciones") {
        return String(segments[0] || "").trim().toLowerCase()
    }
    const params = new URLSearchParams(window.location.search || "")
    return String(params.get("tenant") || "").trim().toLowerCase()
}

function aplicarTenantEnUI() {
    const institucion = String(tenantActivoId || "").trim().replace(/-/g, " ").toUpperCase()
    const label = institucion ? `Institución: ${institucion}` : "Institución no detectada"
    if (tenantLabel) tenantLabel.textContent = label
    document.title = tenantActivoId ? `${tenantActivoId} - asistIA Justificaciones` : "asistIA Justificaciones"
}

function obtenerCursoTokenDesdeURL() {
    const params = new URLSearchParams(window.location.search || "")
    return String(params.get("curso") || "").trim()
}

// ----------------------------------------------------
// DATABASE & OFFLINE STORAGE (IndexedDB)
// ----------------------------------------------------
function abrirBaseDatosOffline() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.warn("IndexedDB no está soportado en este dispositivo.")
            resolve(null)
            return
        }
        const request = window.indexedDB.open(OFFLINE_DB_NAME, 1)
        request.onupgradeneeded = (e) => {
            const database = e.target.result
            if (!database.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
                database.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "id" })
            }
        }
        request.onsuccess = (e) => {
            db = e.target.result
            resolve(db)
        }
        request.onerror = (e) => {
            console.error("Error abriendo IndexedDB:", e.target.error)
            reject(e.target.error)
        }
    })
}

function guardarJustificacionOffline(registro) {
    return new Promise((resolve) => {
        if (!db) {
            resolve(false)
            return
        }
        try {
            const tx = db.transaction([OFFLINE_STORE_NAME], "readwrite")
            const store = tx.objectStore(OFFLINE_STORE_NAME)
            const request = store.put(registro)
            request.onsuccess = () => resolve(true)
            request.onerror = () => resolve(false)
        } catch (e) {
            console.error("Error guardando justificación offline:", e)
            resolve(false)
        }
    })
}

function leerColaJustificacionesOffline() {
    return new Promise((resolve) => {
        if (!db) {
            resolve([])
            return
        }
        try {
            const tx = db.transaction([OFFLINE_STORE_NAME], "readonly")
            const store = tx.objectStore(OFFLINE_STORE_NAME)
            const request = store.getAll()
            request.onsuccess = () => resolve(request.result || [])
            request.onerror = () => resolve([])
        } catch (e) {
            resolve([])
        }
    })
}

function eliminarJustificacionOffline(id) {
    return new Promise((resolve) => {
        if (!db) {
            resolve(false)
            return
        }
        try {
            const tx = db.transaction([OFFLINE_STORE_NAME], "readwrite")
            const store = tx.objectStore(OFFLINE_STORE_NAME)
            const request = store.delete(id)
            request.onsuccess = () => resolve(true)
            request.onerror = () => resolve(false)
        } catch (e) {
            resolve(false)
        }
    })
}

async function actualizarContadorPendientes() {
    if (!pendingCounter) return
    const cola = await leerColaJustificacionesOffline()
    const pendientes = cola.filter(item => item.estado_sync === "pendiente").length
    
    pendingCounter.textContent = pendientes > 0
        ? (pendientes === 1
            ? "1 justificación pendiente de sincronización"
            : `${pendientes} justificaciones pendientes de sincronización`)
        : ""
    
    const enExito = stepExito && stepExito.style.display === "flex"
    pendingCounter.hidden = (pendientes === 0 || enExito)
    pendingCounter.classList.toggle("has-pending", pendientes > 0 && !enExito)
}

// Sincronizar cola de IndexedDB a Supabase
async function sincronizarColaOffline() {
    if (sincronizacionEnCurso || !haySupabase() || !navigator.onLine) {
        await actualizarContadorPendientes()
        return
    }

    const cola = await leerColaJustificacionesOffline()
    if (!cola.length) {
        await actualizarContadorPendientes()
        return
    }

    sincronizacionEnCurso = true
    debugLog("Sincronizando cola offline:", cola.length, "registros pendientes.")
    let sincronizados = 0

    try {
        for (const item of cola) {
            try {
                // Paso 1: Subir el archivo Blob a Storage privado si corresponde
                const tieneArchivo = item.archivo_nombre && item.archivo_nombre !== "no_file"
                
                if (tieneArchivo && (!item.archivo_blob || !(item.archivo_blob instanceof Blob))) {
                    debugLog("Error crítico: archivo_blob ausente o corrupto para justificación offline. Descartando registro.")
                    await eliminarJustificacionOffline(item.id)
                    continue
                }

                const uploadPath = tieneArchivo 
                    ? `${item.tenant_id}/${item.curso_id}/${item.dni}/${item.fecha_registro_dispositivo}_${item.id}_${item.archivo_nombre}`
                    : ""
                
                if (tieneArchivo) {
                    const { error: uploadError } = await supabaseClient.storage
                        .from("justificaciones-sustentos")
                        .upload(uploadPath, item.archivo_blob, {
                            contentType: item.archivo_tipo,
                            cacheControl: "3600",
                            upsert: false
                        })

                    if (uploadError) {
                        if (esErrorConexion(uploadError)) {
                            debugLog("Error de conexión al subir archivo offline, reintentando después...");
                            continue
                        }
                        debugLog("Error crítico de archivo offline, descartando registro:", uploadError.message)
                        await eliminarJustificacionOffline(item.id)
                        continue
                    }
                }

                // Paso 2: Registrar en tabla justificaciones
                const payload = {
                    tenant_id: item.tenant_id,
                    curso_id: item.curso_id,
                    dni: item.dni,
                    nombre: item.nombre,
                    apellido: item.apellido,
                    ubo: item.ubo,
                    seccion: item.seccion,
                    fecha_justificada: item.fecha_justificada,
                    archivo_path: uploadPath,
                    archivo_nombre: item.archivo_nombre,
                    archivo_tipo: item.archivo_tipo,
                    fecha_registro_dispositivo: item.fecha_registro_dispositivo,
                    hora_registro_dispositivo: item.hora_registro_dispositivo,
                    timezone: item.timezone,
                    device_id: item.device_id,
                    estado_revision: "RECIBIDA",
                    motivo_inasistencia: item.motivo_inasistencia || null,
                    motivo_inasistencia_otro: item.motivo_inasistencia_otro || null,
                    tipo_sustento: item.tipo_sustento || null,
                    tipo_sustento_otro: item.tipo_sustento_otro || null
                }

                const { error: insertError } = await supabaseClient
                    .from("justificaciones")
                    .insert([payload])

                if (insertError) {
                    if (esErrorConexion(insertError)) {
                        debugLog("Error de conexión al insertar DB, reintentando...");
                        continue
                    }
                    debugLog("Error crítico al insertar DB, descartando:", insertError.message)
                    // Eliminar el archivo del storage para evitar basura
                    if (uploadPath) {
                        await supabaseClient.storage.from("justificaciones-sustentos").remove([uploadPath])
                    }
                    await eliminarJustificacionOffline(item.id)
                    continue
                }

                sincronizados++
                await eliminarJustificacionOffline(item.id)
            } catch (error) {
                debugLog("Excepción sincronizando fila offline:", error)
            }
        }
    } finally {
        sincronizacionEnCurso = false
        await actualizarContadorPendientes()
    }

    if (sincronizados > 0) {
        setMensaje(
            sincronizados === 1
                ? "✅ Justificación offline sincronizada correctamente."
                : `✅ ${sincronizados} justificaciones offline sincronizadas correctamente.`,
            "ok"
        )
    }
}

// ----------------------------------------------------
// RESOLVER CURSO & CONFIGURACION OPERATIVA
// ----------------------------------------------------
async function resolverCursoPorToken(token) {
    cursoQRValido = false
    if (!token || !tenantActivoId) return false

    const cacheKey = `asistia_curso_qr_${tenantActivoId}_${token}`

    if (!haySupabase() || !navigator.onLine) {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
            try {
                const parsed = JSON.parse(cached)
                cursoActualId = Number(parsed.curso_id || 1) || 1
                cursoQRValido = true
                return true
            } catch (e) {}
        }
        return false
    }

    try {
        const { data, error } = await supabaseClient.rpc("rpc_validar_curso_qr", {
            p_qr_token: token,
            p_tenant_id: tenantActivoId
        })

        if (error || !data?.success) {
            const cached = localStorage.getItem(cacheKey)
            if (cached) {
                try {
                    const parsed = JSON.parse(cached)
                    cursoActualId = Number(parsed.curso_id || 1) || 1
                    cursoQRValido = true
                    return true
                } catch (e) {}
            }
            cursoQRValido = false
            return false
        }

        cursoActualId = Number(data.curso_id || 1) || 1
        cursoQRValido = true
        
        try {
            localStorage.setItem(cacheKey, JSON.stringify({ curso_id: cursoActualId }))
        } catch (e) {}
        
        return true
    } catch (e) {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
            try {
                const parsed = JSON.parse(cached)
                cursoActualId = Number(parsed.curso_id || 1) || 1
                cursoQRValido = true
                return true
            } catch (err) {}
        }
        cursoQRValido = false
        return false
    }
}

async function cargarConfiguracionOperativa() {
    if (!haySupabase() || !tenantActivoId || !cursoActualId) {
        inicializarCatalogos()
        return
    }

    try {
        const { data, error } = await supabaseClient
            .from("curso_configuracion")
            .select("oper_justif_plazo_dias, oper_justif_doc_obligatorio, oper_justif_max_size_mb, oper_justif_tipos_permitidos")
            .eq("tenant_id", tenantActivoId)
            .maybeSingle()

        if (!error && data) {
            configuracionOperativa = {
                plazoDias: Number(data.oper_justif_plazo_dias ?? 3),
                docObligatorio: !!(data.oper_justif_doc_obligatorio ?? true),
                maxSizeMb: Number(data.oper_justif_max_size_mb ?? 2.0),
                tiposPermitidos: String(data.oper_justif_tipos_permitidos || "pdf,jpg,jpeg,png")
            }
            localStorage.setItem(`asistia_justif_config_${tenantActivoId}`, JSON.stringify(configuracionOperativa))
            debugLog("Configuración operativa cargada de DB:", configuracionOperativa)
        } else {
            const cached = localStorage.getItem(`asistia_justif_config_${tenantActivoId}`)
            if (cached) {
                configuracionOperativa = JSON.parse(cached)
            }
        }
    } catch (e) {
        console.warn("No se pudo cargar curso_configuracion, usando fallbacks locales:", e)
        const cached = localStorage.getItem(`asistia_justif_config_${tenantActivoId}`)
        if (cached) {
            configuracionOperativa = JSON.parse(cached)
        }
    } finally {
        inicializarCatalogos()
    }
}

// ----------------------------------------------------
// LOGICA DE FLUJO & COMPORTAMIENTO UI
// ----------------------------------------------------
function mostrarPaso(paso) {
    stepIngreso.style.display = paso === "ingreso" ? "flex" : "none"
    stepFecha.style.display = paso === "fecha" ? "flex" : "none"
    stepSustento.style.display = paso === "sustento" ? "flex" : "none"
    stepExito.style.display = paso === "exito" ? "flex" : "none"

    if (paso === "sustento") {
        asegurarCatalogosVisibles()
    }

    if (paso === "exito") {
        setMensaje("")
        if (pendingCounter) pendingCounter.hidden = true
    } else {
        void actualizarContadorPendientes()
    }
}

// PASO 1 -> PASO 2: Validar DNI
async function procesarPaso1() {
    setMensaje("")
    const dni = String(mobileDniInicio?.value || "").replace(/\D/g, "").slice(0, 8)
    if (mobileDniInicio) mobileDniInicio.value = dni

    if (dni.length !== 8) {
        setMensaje("⚠ Ingresa un DNI de 8 dígitos para continuar", "error")
        return
    }

    if (!cursoQRValido) {
        setMensaje("QR inválido o curso no disponible.", "error")
        return
    }

    btnIngresarInicio.disabled = true
    setMensaje("Validando padrón...", "ok")

    try {
        const { data, error } = await supabaseClient
            .from("aspirantes")
            .select("nombres, apellidos, ubo, seccion, curso_id")
            .eq("dni", dni)
            .eq("tenant_id", tenantActivoId)
            .limit(1)
            .maybeSingle()

        if (error) {
            throw error
        }

        if (!data) {
            setMensaje("⚠ El DNI ingresado no existe en el padrón de la institución.", "warning")
            btnIngresarInicio.disabled = false
            return
        }

        const cursoAspirante = data.curso_id == null ? null : Number(data.curso_id)
        if (cursoAspirante != null && cursoAspirante !== cursoActualId) {
            setMensaje("⚠ El aspirante no pertenece al curso de este QR.", "error")
            btnIngresarInicio.disabled = false
            return
        }

        // Estudiante activo validado
        validacionDniAspirante = {
            dni,
            nombres: data.nombres || "",
            apellidos: data.apellidos || "",
            ubo: data.ubo || "",
            seccion: data.seccion || "GENERAL"
        }

        // Renderizar tarjeta de estudiante
        studentDetailsCard.innerHTML = `
            <div class="context-card">
                <div class="context-card-head">
                    <p class="context-title">Aspirante detectado</p>
                    <p class="context-person">${escapeHTML(validacionDniAspirante.nombres + " " + validacionDniAspirante.apellidos)}</p>
                </div>
                <div class="context-grid">
                    <div class="context-item">
                        <span class="context-item-label">DNI</span>
                        <span class="context-item-value">${escapeHTML(dni)}</span>
                    </div>
                    <div class="context-item">
                        <span class="context-item-label">Sección</span>
                        <span class="context-item-value">${escapeHTML(validacionDniAspirante.seccion)}</span>
                    </div>
                    <div class="context-item">
                        <span class="context-item-label">UBO Origen</span>
                        <span class="context-item-value">${escapeHTML(validacionDniAspirante.ubo)}</span>
                    </div>
                </div>
            </div>
        `

        setMensaje("")
        mostrarPaso("fecha")
        fechaJustificar.focus()
    } catch (e) {
        console.error("Error en paso 1:", e)
        setMensaje("No se pudo conectar con el servidor para validar el DNI.", "error")
    } finally {
        btnIngresarInicio.disabled = false
    }
}

// Formateador de fecha manual dd/mm/aaaa
function formatearEntradaFecha(valor) {
    let limpia = valor.replace(/\D/g, "")
    if (limpia.length > 8) limpia = limpia.slice(0, 8)
    
    if (limpia.length > 4) {
        return `${limpia.slice(0, 2)}/${limpia.slice(2, 4)}/${limpia.slice(4)}`
    } else if (limpia.length > 2) {
        return `${limpia.slice(0, 2)}/${limpia.slice(2)}`
    }
    return limpia
}

function parseFechaDate(str) {
    const parts = str.split("/")
    if (parts.length !== 3) return null
    const dia = parseInt(parts[0], 10)
    const mes = parseInt(parts[1], 10) - 1
    const anio = parseInt(parts[2], 10)
    const d = new Date(anio, mes, dia)
    if (d.getFullYear() === anio && d.getMonth() === mes && d.getDate() === dia) {
        return d
    }
    return null
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
        timestamp: fechaBase.toISOString()
    }
}

// PASO 2 -> PASO 3: Validar Fecha e Identificar Justificación
async function procesarPaso2() {
    setMensaje("")
    const rawFecha = String(fechaJustificar?.value || "").trim()
    const regexFormato = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/

    if (!regexFormato.test(rawFecha)) {
        setMensaje("⚠ El formato de fecha debe ser dd/mm/aaaa. Ejemplo: 10/07/2026", "error")
        return
    }

    const fechaDate = parseFechaDate(rawFecha)
    if (!fechaDate) {
        setMensaje("⚠ Fecha ingresada no es válida.", "error")
        return
    }

    // Obtener fecha actual en Lima
    const ahoraLimaInfo = obtenerFechaHoraLima(new Date())
    const fechaActualStr = ahoraLimaInfo.fecha
    const actualDate = new Date(fechaActualStr + "T00:00:00")
    const justifDate = new Date(fechaDate.getFullYear() + "-" + String(fechaDate.getMonth() + 1).padStart(2, "0") + "-" + String(fechaDate.getDate()).padStart(2, "0") + "T00:00:00")

    if (justifDate > actualDate) {
        setMensaje("⚠ La fecha a justificar no puede ser una fecha futura.", "error")
        return
    }

    // Validar plazo en días
    const diffTime = actualDate - justifDate
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays > configuracionOperativa.plazoDias) {
        setMensaje("La fecha indicada excede el plazo permitido para registrar una justificación.", "error")
        return
    }

    if (!haySupabase() || !navigator.onLine) {
        // En modo offline, permitimos pasar al siguiente paso con validaciones básicas de frontend
        summaryDni.textContent = validacionDniAspirante.dni
        summaryFecha.textContent = rawFecha
        mostrarPaso("sustento")
        setMensaje("Sin conexión. La justificación será validada operativamente al sincronizar.", "warning")
        return
    }

    btnValidarFecha.disabled = true
    setMensaje("Validando vinculación administrativa en fecha...", "ok")

    try {
        const fechaFormatoDB = `${fechaDate.getFullYear()}-${String(fechaDate.getMonth() + 1).padStart(2, "0")}-${String(fechaDate.getDate()).padStart(2, "0")}`
        
        const { data, error } = await supabaseClient.rpc("rpc_validar_fecha_justificable", {
            p_tenant_id: tenantActivoId,
            p_curso_id: cursoActualId,
            p_dni: validacionDniAspirante.dni,
            p_fecha: fechaFormatoDB
        })

        if (error) throw error

        if (!data || !data.justificable) {
            setMensaje("⚠ " + (data?.reason || "No se puede justificar la fecha seleccionada."), "error")
            btnValidarFecha.disabled = false
            return
        }

        // Habilitar paso 3
        summaryDni.textContent = validacionDniAspirante.dni
        summaryFecha.textContent = rawFecha
        setMensaje("")
        mostrarPaso("sustento")
    } catch (e) {
        console.error("Error validando fecha justificable:", e)
        setMensaje("No se pudo verificar si la fecha es justificable. Si estás offline, reintenta.", "error")
    } finally {
        btnValidarFecha.disabled = false
    }
}

// PASO 3 -> PASO 4: Registrar Justificación
async function procesarPaso3() {
    setMensaje("")

    if (configuracionOperativa.docObligatorio && !fileSeleccionado) {
        setMensaje("⚠ Es obligatorio adjuntar un archivo de sustento.", "error")
        return
    }

    if (!selectMotivo?.value) {
        setMensaje("⚠ Debe seleccionar el motivo de la inasistencia.", "error")
        return
    }
    if (selectMotivo.value === "Otro" && !inputMotivoOtro?.value.trim()) {
        setMensaje("⚠ Debe especificar el motivo de la inasistencia.", "error")
        return
    }

    if (!selectTipoSustento?.value) {
        setMensaje("⚠ Debe seleccionar el tipo de sustento presentado.", "error")
        return
    }
    if (selectTipoSustento.value === "Otro" && !inputSustentoOtro?.value.trim()) {
        setMensaje("⚠ Debe especificar el tipo de sustento presentado.", "error")
        return
    }

    btnRegistrarJustificacion.disabled = true
    setMensaje("Procesando registro...", "ok")

    const rawFecha = summaryFecha.textContent
    const fechaDate = parseFechaDate(rawFecha)
    const fechaFormatoDB = `${fechaDate.getFullYear()}-${String(fechaDate.getMonth() + 1).padStart(2, "0")}-${String(fechaDate.getDate()).padStart(2, "0")}`

    const dispositivoInfo = obtenerFechaHoraLima(new Date())
    const idLocal = `just-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    const offlineReg = {
        id: idLocal,
        tenant_id: tenantActivoId,
        curso_id: cursoActualId,
        dni: validacionDniAspirante.dni,
        nombre: validacionDniAspirante.nombres,
        apellido: validacionDniAspirante.apellidos,
        ubo: validacionDniAspirante.ubo,
        seccion: validacionDniAspirante.seccion,
        fecha_justificada: fechaFormatoDB,
        archivo_blob: fileSeleccionado,
        archivo_nombre: fileSeleccionado ? sanitizeFileName(fileSeleccionado.name) : "no_file",
        archivo_tipo: fileSeleccionado ? fileSeleccionado.type : "application/octet-stream",
        fecha_registro_dispositivo: dispositivoInfo.fecha,
        hora_registro_dispositivo: dispositivoInfo.hora,
        timezone: "America/Lima",
        device_id: getDeviceId(),
        estado_sync: "pendiente",
        motivo_inasistencia: selectMotivo.value,
        motivo_inasistencia_otro: selectMotivo.value === "Otro" ? inputMotivoOtro.value.trim() : null,
        tipo_sustento: selectTipoSustento.value,
        tipo_sustento_otro: selectTipoSustento.value === "Otro" ? inputSustentoOtro.value.trim() : null
    }

    // Flujo Offline Contingency
    if (!haySupabase() || !navigator.onLine) {
        const guardado = await guardarJustificacionOffline(offlineReg)
        btnRegistrarJustificacion.disabled = false
        if (guardado) {
            setMensaje("Sin conexión. Justificación guardada en el dispositivo. Se sincronizará automáticamente.", "warning")
            await actualizarContadorPendientes()
            mostrarPaso("exito")
            limpiarPasoSustento()
        } else {
            setMensaje("⚠ No se pudo guardar la justificación localmente (IndexedDB deshabilitado).", "error")
        }
        return
    }

    // Flujo Online Directo
    try {
        let uploadPath = ""
        
        if (fileSeleccionado) {
            uploadPath = `${tenantActivoId}/${cursoActualId}/${validacionDniAspirante.dni}/${dispositivoInfo.fecha}_${idLocal}_${sanitizeFileName(fileSeleccionado.name)}`
            
            const { error: uploadError } = await supabaseClient.storage
                .from("justificaciones-sustentos")
                .upload(uploadPath, fileSeleccionado, {
                    contentType: fileSeleccionado.type,
                    cacheControl: "3600",
                    upsert: false
                })

            if (uploadError) throw uploadError
        }

        const payload = {
            tenant_id: tenantActivoId,
            curso_id: cursoActualId,
            dni: validacionDniAspirante.dni,
            nombre: validacionDniAspirante.nombres,
            apellido: validacionDniAspirante.apellidos,
            ubo: validacionDniAspirante.ubo,
            seccion: validacionDniAspirante.seccion,
            fecha_justificada: fechaFormatoDB,
            archivo_path: uploadPath,
            archivo_nombre: fileSeleccionado ? sanitizeFileName(fileSeleccionado.name) : "no_file",
            archivo_tipo: fileSeleccionado ? fileSeleccionado.type : "no_type",
            fecha_registro_dispositivo: dispositivoInfo.fecha,
            hora_registro_dispositivo: dispositivoInfo.hora,
            timezone: "America/Lima",
            device_id: getDeviceId(),
            estado_revision: "RECIBIDA",
            motivo_inasistencia: selectMotivo.value,
            motivo_inasistencia_otro: selectMotivo.value === "Otro" ? inputMotivoOtro.value.trim() : null,
            tipo_sustento: selectTipoSustento.value,
            tipo_sustento_otro: selectTipoSustento.value === "Otro" ? inputSustentoOtro.value.trim() : null
        }

        const { error: insertError } = await supabaseClient
            .from("justificaciones")
            .insert([payload])

        if (insertError) {
            // Deshacer subida en storage
            if (uploadPath) {
                await supabaseClient.storage.from("justificaciones-sustentos").remove([uploadPath])
            }
            throw insertError
        }

        // Eliminar de la cola offline si existiera por si acaso
        await eliminarJustificacionOffline(idLocal)

        // Lanzar sincronización en segundo plano para procesar cualquier otra justificación offline pendiente
        if (navigator.onLine) {
            void sincronizarColaOffline()
        } else {
            await actualizarContadorPendientes()
        }

        setMensaje("✅ Justificación enviada para revisión.", "ok")
        mostrarPaso("exito")
        limpiarPasoSustento()
    } catch (e) {
        console.error("Error en flujo online de justificación:", e)
        // Guardar offline por contingencia de red
        const guardado = await guardarJustificacionOffline(offlineReg)
        if (guardado) {
            setMensaje("Error de red. Justificación guardada localmente para reintento automático.", "warning")
            await actualizarContadorPendientes()
            mostrarPaso("exito")
            limpiarPasoSustento()
        } else {
            setMensaje("No se pudo registrar la justificación. Intenta de nuevo.", "error")
        }
    } finally {
        btnRegistrarJustificacion.disabled = false
    }
}

function sanitizeFileName(nombre) {
    return String(nombre || "archivo")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
}

function handleSeleccionArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setMensaje("")
    const ext = file.name.split(".").pop().toLowerCase()
    const tiposArr = configuracionOperativa.tiposPermitidos.split(",").map(x => x.trim().toLowerCase())

    if (!tiposArr.includes(ext)) {
        setMensaje(`⚠ Tipo de archivo no permitido. Tipos válidos: ${configuracionOperativa.tiposPermitidos.toUpperCase()}`, "error")
        fileSustento.value = ""
        fileSeleccionado = null
        fileMetaInfo.style.display = "none"
        return
    }

    const pesoMb = file.size / (1024 * 1024)
    if (pesoMb > configuracionOperativa.maxSizeMb) {
        setMensaje(`⚠ El archivo supera el tamaño máximo permitido de ${configuracionOperativa.maxSizeMb} MB.`, "error")
        fileSustento.value = ""
        fileSeleccionado = null
        fileMetaInfo.style.display = "none"
        return
    }

    fileSeleccionado = file
    fileName.textContent = file.name
    fileSize.textContent = `${pesoMb.toFixed(2)} MB`
    fileMetaInfo.style.display = "flex"
    dropzoneLabel.classList.add("has-file")
}

function limpiarPasoSustento() {
    fileSeleccionado = null
    if (fileSustento) fileSustento.value = ""
    if (fileMetaInfo) fileMetaInfo.style.display = "none"
    if (dropzoneLabel) dropzoneLabel.classList.remove("has-file")
    if (selectMotivo) selectMotivo.value = ""
    if (selectTipoSustento) selectTipoSustento.value = ""
    if (inputMotivoOtro) inputMotivoOtro.value = ""
    if (inputSustentoOtro) inputSustentoOtro.value = ""
    if (wrapperMotivoOtro) wrapperMotivoOtro.style.display = "none"
    if (wrapperSustentoOtro) wrapperSustentoOtro.style.display = "none"
}

function resetTodoElFlujo() {
    setMensaje("")
    if (mobileDniInicio) mobileDniInicio.value = ""
    if (fechaJustificar) fechaJustificar.value = ""
    validacionDniAspirante = null
    limpiarPasoSustento()
    mostrarPaso("ingreso")
}

function bindEventos() {
    btnIngresarInicio?.addEventListener("click", procesarPaso1)
    mobileDniInicio?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") procesarPaso1()
    })

    fechaJustificar?.addEventListener("input", (e) => {
        e.target.value = formatearEntradaFecha(e.target.value)
    })
    fechaJustificar?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") procesarPaso2()
    })

    btnValidarFecha?.addEventListener("click", procesarPaso2)
    btnVolverPaso1?.addEventListener("click", () => mostrarPaso("ingreso"))

    fileSustento?.addEventListener("change", handleSeleccionArchivo)
    btnRegistrarJustificacion?.addEventListener("click", procesarPaso3)
    btnVolverPaso2?.addEventListener("click", () => mostrarPaso("fecha"))

    btnNuevaJustificacion?.addEventListener("click", resetTodoElFlujo)

    selectMotivo?.addEventListener("change", (e) => {
        if (wrapperMotivoOtro) wrapperMotivoOtro.style.display = e.target.value === "Otro" ? "block" : "none"
    })

    selectTipoSustento?.addEventListener("change", (e) => {
        if (wrapperSustentoOtro) wrapperSustentoOtro.style.display = e.target.value === "Otro" ? "block" : "none"
    })
}

async function init() {
    enlazarIds()
    bindEventos()
    inicializarCatalogos()

    tenantActivoId = detectarTenantDesdeRuta()
    aplicarTenantEnUI()

    if (!tenantActivoId) {
        setMensaje("QR inválido o curso no disponible.", "error")
        if (mobileDniInicio) mobileDniInicio.disabled = true
        if (btnIngresarInicio) btnIngresarInicio.disabled = true
        return
    }

    if (!haySupabase()) {
        setMensaje("No se pudo conectar con asistIA.", "error")
        return
    }

    await abrirBaseDatosOffline()
    await actualizarContadorPendientes()

    const token = obtenerCursoTokenDesdeURL()
    const cursoValido = await resolverCursoPorToken(token)

    if (!cursoValido || !cursoQRValido) {
        if (tenantActivoId) {
            cursoQRValido = true
            cursoActualId = cursoActualId || 1
            setMensaje("Modo contingencia activo. Registros se sincronizarán al volver a conectar.", "warning")
        } else {
            setMensaje("QR inválido o curso no disponible.", "error")
            if (mobileDniInicio) mobileDniInicio.disabled = true
            if (btnIngresarInicio) btnIngresarInicio.disabled = true
            return
        }
    }

    await cargarConfiguracionOperativa()
    asegurarCatalogosVisibles()
    mostrarPaso("ingreso")

    // Sincronizar cola si hay internet
    if (navigator.onLine) {
        void sincronizarColaOffline()
    }
}

window.addEventListener("load", () => {
    void init()
})

window.addEventListener("online", () => {
    setMensaje("Conexión restablecida. Sincronizando pendientes...", "ok")
    void sincronizarColaOffline()
})

window.addEventListener("offline", () => {
    setMensaje("Sin conexión. Se activará el almacenamiento local.", "warning")
})

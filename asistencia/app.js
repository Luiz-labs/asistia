const supabaseUrl = "https://kcapmyovaigjntaqeqwn.supabase.co"
const supabaseKey = "sb_publishable_oObf3s5mQ4sfmJ03JKQrnQ__8Rmb63F"

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null

let tenantActivoId = ""
let cursoActualId = 1
let cursoQRValido = false
let cursoValidadoEnSesion = false
let dniMovil = ""
let seccion = ""
let cursoConfigCache = null
let cursoSecciones = []
let debounceTimerAutocompletar = null
let retornoPostRegistroTimer = 0
let validacionCursoAspirante = { dni: "", permitido: true, legacy: false, bloqueado: false }
let perfilAspiranteActual = { dni: "", seccion: "" }
let contextoAsistenciaActual = null
let ultimoGpsData = null
let ultimoResultadoRegistro = null
let sincronizacionPendientesEnCurso = false
let ultimoEstadoCurso = { code: "idle", message: "" }
const OFFLINE_QUEUE_KEY = "asistia_aspirantes_offline_queue_v1"

let tenantLabel
let stepIngreso
let formulario
let mobileDniInicio
let nombres
let apellidos
let ubo
let aspiranteLegacyFields
let mensaje
let mobileSectionsContainer
let pendingCounter

function debugContextLog(...args) {
    console.log("[asistIA-context-debug]", ...args)
}

function actualizarDebugContextGlobal() {
    window.__asistIAContextDebug = {
        getContext: () => contextoAsistenciaActual,
        hasRPC: () => tieneContextoRPCActivo(),
        getHTML: () => mobileSectionsContainer?.innerHTML,
        getState: () => ({
            dniMovil,
            seccion,
            tenantActivoId,
            cursoQRValido,
            cursoActualId
        })
    }
}

function haySupabase() {
    return !!supabaseClient
}

function enlazarIds() {
    tenantLabel = document.getElementById("tenantLabel")
    stepIngreso = document.getElementById("stepIngreso")
    formulario = document.getElementById("formulario")
    mobileDniInicio = document.getElementById("mobileDniInicio")
    nombres = document.getElementById("nombres")
    apellidos = document.getElementById("apellidos")
    ubo = document.getElementById("ubo")
    aspiranteLegacyFields = document.getElementById("aspiranteLegacyFields")
    mensaje = document.getElementById("mensaje")
    mobileSectionsContainer = document.getElementById("mobileSectionsContainer")
    pendingCounter = document.getElementById("pendingCounter")
    actualizarDebugContextGlobal()
}

function detectarTenantDesdeRuta() {
    const segments = String(window.location.pathname || "").split("/").filter(Boolean)
    const idxAsistencia = segments.indexOf("asistencia")
    if (idxAsistencia > 0) {
        return String(segments[idxAsistencia - 1] || "").trim().toLowerCase()
    }
    if (segments[0] && segments[0] !== "asistencia") {
        return String(segments[0] || "").trim().toLowerCase()
    }
    const params = new URLSearchParams(window.location.search || "")
    return String(params.get("tenant") || "").trim().toLowerCase()
}

function aplicarTenantEnUI() {
    const institucion = String(tenantActivoId || "").trim().replace(/-/g, " ").toUpperCase()
    const label = institucion ? `Institución: ${institucion}` : "Institución no detectada"
    if (tenantLabel) tenantLabel.textContent = label
    document.title = tenantActivoId ? `${tenantActivoId} - asistIA Asistencia` : "asistIA Asistencia"
}

function setMensaje(texto, tipo = "") {
    if (!mensaje) return
    mensaje.className = "message-box"
    mensaje.innerHTML = texto || ""
    if (!texto) return
    if (tipo) mensaje.classList.add(tipo)
}

function esErrorConexion(error) {
    const texto = String(error?.message || error || "").toLowerCase()
    return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|temporarily unavailable|connection|offline/i.test(texto)
}

function mensajeAmigable(error, fallback = "Ocurrió un problema al procesar la solicitud.") {
    if (esErrorConexion(error)) return "No se pudo conectar con asistIA. Verifica tu conexión e inténtalo nuevamente."
    return fallback
}

function escapeHTML(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

function aplicarReadonlyVisual(input, readOnly = false) {
    if (!input) return
    input.readOnly = !!readOnly
    input.classList.toggle("is-readonly", !!readOnly)
}

function debeOcultarMensajePublico(item) {
    const code = String(item?.code || "").trim().toLowerCase()
    const message = String(item?.message || item || "").trim().toLowerCase()
    return code === "device_id_ausente" || message === "no se recibió identificador de dispositivo."
}

function deduplicarMensajes(messages = []) {
    const seen = new Set()
    return messages.filter(item => {
        const key = String(item || "").replace(/\.+$/, "").trim().toLowerCase()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function normalizarMensajePublicoFinal(texto = "") {
    const partes = String(texto || "")
        .split("|")
        .map(item => String(item || "").trim())
        .filter(Boolean)
    return deduplicarMensajes(partes).join(" | ")
}

function construirClaveMensajePublico(item) {
    const code = String(item?.code || "").trim().toLowerCase()
    const message = String(item?.message || item || "").trim().toLowerCase()
    return code ? `${code}|${message}` : message
}

function mostrarPasoMovil(paso) {
    if (stepIngreso) stepIngreso.style.display = paso === "ingreso" ? "flex" : "none"
}

function cancelarRetornoPostRegistro() {
    if (retornoPostRegistroTimer) {
        window.clearTimeout(retornoPostRegistroTimer)
        retornoPostRegistroTimer = 0
    }
}

function limpiarDni(valor = "") {
    return String(valor || "").replace(/\D/g, "").slice(0, 8)
}

function esTablaNoExiste(error) {
    return /does not exist|42P01/i.test(String(error?.message || ""))
}

function withTenantScope(query) {
    if (!tenantActivoId) return query
    return query.eq("tenant_id", tenantActivoId)
}

function obtenerCursoTokenDesdeURL() {
    try {
        const params = new URLSearchParams(window.location.search || "")
        return String(params.get("curso") || "").trim()
    } catch (e) {
        return ""
    }
}

function obtenerCursoTokenDesdeTextoQR(raw) {
    const text = String(raw || "").trim()
    if (!text) return ""
    try {
        const url = new URL(text)
        return String(url.searchParams.get("curso") || "").trim()
    } catch (e) {
        const match = text.match(/[?&]curso=([^&#\s]+)/i)
        if (match?.[1]) return decodeURIComponent(String(match[1] || "").trim())
        return ""
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
        timestamp: fechaBase.toISOString(),
        weekday: new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Lima",
            weekday: "long"
        }).format(fechaBase).toLowerCase()
    }
}

function normalizarCodigoSeccion(valor) {
    return String(valor || "").trim().toUpperCase()
}

function esSeccionLegacy(valor) {
    const seccionNormalizada = normalizarCodigoSeccion(valor)
    return seccionNormalizada === "GENERAL" || seccionNormalizada === "DOMINICAL"
}

function esTodosAspirantes(ctx) {
    if (!ctx) return false
    const origen = String(ctx.origen_contexto || "").trim()
    const jornada = String(ctx.jornada_codigo || ctx.tipo_jornada || "").trim().toUpperCase()
    return origen === "calendario_global_todos_aspirantes" || jornada === "CALENDARIO_GLOBAL"
}

function obtenerMensajesAdvertenciaAmigables(contexto) {
    if (!contexto) return []
    const friendlyWarnings = []
    const rawWarnings = Array.isArray(contexto.warnings) ? contexto.warnings : []
    
    let tieneAnticipado = false
    let tieneTardanza = false
    let tieneGpsNoDisp = false
    
    rawWarnings.forEach(w => {
        const code = String(w?.code || "").toLowerCase().trim()
        const msg = String(w?.message || w || "").toLowerCase().trim()
        
        if (code === "anticipado" || msg.includes("anticipado")) {
            tieneAnticipado = true
        }
        if (code === "tardanza" || msg.includes("tardanza")) {
            tieneTardanza = true
        }
        if (code === "gps_no_disponible" || msg.includes("gps") || msg.includes("coordenadas") || msg.includes("validación gps")) {
            tieneGpsNoDisp = true
        }
    })
    
    const estado = String(contexto.estado_asistencia || "").toUpperCase().trim()
    if (estado === "TARDANZA") {
        tieneTardanza = true
    }
    
    if (tieneAnticipado) {
        friendlyWarnings.push("Estás intentando registrar tu asistencia antes del horario programado.")
    } else if (estado === "FUERA_DE_HORARIO") {
        friendlyWarnings.push("Tu registro está fuera del horario programado.")
    }
    
    if (tieneTardanza) {
        friendlyWarnings.push("Tu registro será considerado como tardanza.")
    }
    
    if (tieneGpsNoDisp) {
        friendlyWarnings.push("No fue posible validar tu ubicación GPS.")
    }
    
    return friendlyWarnings
}

function formatearDistancia(metros) {
    if (metros == null) return ""
    const m = Number(metros)
    if (isNaN(m)) return ""
    if (m < 1000) {
        return `${Math.round(m)} m`
    } else {
        const km = m / 1000
        const kmRedondeado = Math.round(km * 100) / 100
        return `${kmRedondeado} km`
    }
}

function generarIdReporte(dni) {
    const ahora = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const yyyy = ahora.getFullYear()
    const mm = pad(ahora.getMonth() + 1)
    const dd = pad(ahora.getDate())
    const hh = pad(ahora.getHours())
    const min = pad(ahora.getMinutes())
    const ss = pad(ahora.getSeconds())
    const dniLimpio = limpiarDni(dni) || "SIN_DNI"
    return `ASISTIA-${yyyy}${mm}${dd}-${hh}${min}${ss}-${dniLimpio}`
}

function detectarEstadoProblema() {
    const msgText = String(mensaje?.textContent || "").trim()
    const ctx = contextoAsistenciaActual
    const gps = ultimoGpsData
    
    let problema = "Consulta general"
    let prioridad = "BAJA"
    
    if (msgText.includes("no existe en el padrón") || msgText.includes("no pertenece al curso")) {
        problema = "DNI no encontrado"
        prioridad = "ALTA"
        return { problema, prioridad }
    }
    
    if (msgText.includes("no hay clase programada") || msgText.includes("no hay jornada programada") || msgText.includes("no hay clase programada para registrar")) {
        problema = "No hay jornada programada"
        prioridad = "ALTA"
        return { problema, prioridad }
    }
    
    if (msgText.includes("no tiene sección asignada") || (ctx?.bloqueos || []).some(b => b.code === "aspirante_sin_seccion")) {
        problema = "Aspirante sin sección"
        prioridad = "ALTA"
        return { problema, prioridad }
    }
    
    if (msgText.includes("error") || msgText.includes("no se pudo") || msgText.includes("problema al procesar") || msgText.includes("falló")) {
        problema = "Error interno"
        prioridad = "ALTA"
        return { problema, prioridad }
    }
    
    if (msgText.includes("validar tu ubicación gps") || (gps && gps.estado === "GPS_NO_DISPONIBLE")) {
        problema = "GPS no disponible"
        const modo = gps?.modo || ""
        if (modo === "bloquear_fuera" || modo === "bloquear_fuera_sin_gps") {
            prioridad = "ALTA"
        } else {
            prioridad = "MEDIA"
        }
        return { problema, prioridad }
    }
    
    if (msgText.includes("fuera del área autorizada") || (gps && gps.estado === "GPS_FUERA_RANGO")) {
        problema = "Fuera de geocerca"
        prioridad = "MEDIA"
        return { problema, prioridad }
    }
    
    if (ctx?.estado_asistencia === "FUERA_DE_HORARIO" || msgText.includes("fuera del horario programado") || msgText.includes("fuera de horario")) {
        problema = "Fuera de horario"
        prioridad = "MEDIA"
        return { problema, prioridad }
    }
    
    if (ctx?.estado_asistencia === "TARDANZA" || msgText.includes("tardanza")) {
        problema = "Tardanza"
        prioridad = "MEDIA"
        return { problema, prioridad }
    }
    
    return { problema, prioridad }
}

function generarMensajeWhatsApp() {
    const dni = limpiarDni(dniMovil || mobileDniInicio?.value) || "SIN_DNI"
    const idReporte = generarIdReporte(dni)
    const { problema, prioridad } = detectarEstadoProblema()
    
    const ctx = contextoAsistenciaActual
    const gps = ultimoGpsData
    
    const aDni = dni !== "SIN_DNI" ? dni : "Datos aún no validados"
    const aNombres = String(nombres?.value || "").trim() || "Datos aún no validados"
    const aApellidos = String(apellidos?.value || "").trim() || "Datos aún no validados"
    const aNombreCompleto = (aNombres !== "Datos aún no validados" && aApellidos !== "Datos aún no validados")
        ? `${aNombres} ${aApellidos}`
        : "Datos aún no validados"
    const aUbo = String(ubo?.value || "").trim() || "Datos aún no validados"
    const aSeccion = String(ctx?.seccion || seccion || "").trim() || "Datos aún no validados"
    const aCurso = String(cursoConfigCache?.nombre_curso || cursoActualId || "").trim() || "Datos aún no validados"
    const aInstitucion = String(tenantActivoId || "").trim().toUpperCase()
    
    const rEstado = ctx?.estado_asistencia_label || ctx?.estado_asistencia || "Pendiente de resolver"
    const rJornada = ctx?.tipo_jornada_label || ctx?.tipo_jornada || "Pendiente de resolver"
    const rModalidad = ctx?.modalidad_label || ctx?.modalidad || "Pendiente de resolver"
    const rFecha = ctx?.fecha || obtenerFechaHoraLima(new Date()).fecha
    const rHora = ctx?.hora || obtenerFechaHoraLima(new Date()).hora
    
    let rGps = "No disponible"
    if (gps) {
        if (gps.estado === "GPS_DENTRO_RANGO") rGps = "Dentro de geocerca"
        else if (gps.estado === "GPS_FUERA_RANGO") rGps = "Fuera de geocerca"
    }
    
    const rDistancia = (gps && gps.distancia_metros != null) ? formatearDistancia(gps.distancia_metros) : "N/A"
    
    const appVersion = "1.0.0-build10020"
    
    const msg = `ID reporte:
${idReporte}

Prioridad:
${prioridad}

Problema detectado:
- ${problema}

Datos del aspirante:
- DNI: ${aDni}
- Nombres: ${aNombres}
- Apellidos: ${aApellidos}
- Nombre completo: ${aNombreCompleto}
- UBO: ${aUbo}
- Sección: ${aSeccion}
- Curso: ${aCurso}
- Institución: ${aInstitucion}

Datos del registro/contexto:
- Estado del registro: ${rEstado}
- Jornada: ${rJornada}
- Modalidad: ${rModalidad}
- Fecha: ${rFecha}
- Hora local: ${rHora}
- Ubicación/GPS: ${rGps}
- Distancia si existe: ${rDistancia}
- URL actual: ${window.location.href}
- Versión asistIA: ${appVersion}

Datos automáticos del dispositivo:
- User agent: ${navigator.userAgent}
- Plataforma: ${navigator.platform || "Desconocida"}
- Idioma: ${navigator.language || "es"}
- Tamaño de pantalla: ${window.screen.width || 0}x${window.screen.height || 0}
- Online/offline: ${navigator.onLine ? "Online" : "Offline"}
- Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima"}

Texto editable para el usuario:
"Descripción del problema:
"`
    
    return msg
}

function abrirWhatsAppSoporte() {
    const text = generarMensajeWhatsApp()
    const url = `https://wa.me/51983230353?text=${encodeURIComponent(text)}`
    window.open(url, "_blank")
}

function normalizarModalidad(valor) {
    const modalidad = String(valor || "").trim().toUpperCase()
    if (modalidad === "VIRTUAL") return "VIRTUAL"
    return modalidad ? "PRESENCIAL" : ""
}

function formatearTipoJornadaAmigable(valor) {
    const jornada = String(valor || "").trim().toUpperCase()
    if (jornada === "DOMINICAL" || jornada === "DOMINICAL_GRUPAL") return "Dominical grupal"
    if (jornada === "SECCION" || jornada === "SECCION_REGULAR") return "Regular de sección"
    if (jornada === "GENERAL") return "General"
    return jornada || "Regular de sección"
}

function formatearModalidadAmigable(valor) {
    const modalidad = normalizarModalidad(valor)
    if (modalidad === "VIRTUAL") return "Virtual"
    if (modalidad === "PRESENCIAL") return "Presencial"
    return ""
}

function formatearEstadoAsistenciaAmigable(valor) {
    const estado = String(valor || "").trim().toUpperCase()
    if (estado === "PUNTUAL") return "Puntual"
    if (estado === "TARDANZA") return "Tardanza"
    if (estado === "FUERA_DE_HORARIO") return "Fuera de horario"
    return ""
}

function normalizarEstadoAsistencia(valor) {
    const estado = String(valor || "").trim().toUpperCase()
    return estado || null
}

function tieneContextoRPCActivo() {
    const origen = String(contextoAsistenciaActual?.origen_contexto || "").trim()
    return origen !== "" && origen !== "frontend_fallback"
}

function contextoCorrespondeADni(dniValor) {
    const dniNormalizado = limpiarDni(dniValor)
    const dniContexto = limpiarDni(contextoAsistenciaActual?.aspirante?.dni || dniMovil || "")
    return !!dniNormalizado && !!dniContexto && dniNormalizado === dniContexto
}

function obtenerTipoJornadaAspirante(weekday) {
    return weekday === "sunday" ? "DOMINICAL_GRUPAL" : "SECCION_REGULAR"
}

function obtenerSeccionAspiranteDetectada() {
    return esSeccionLegacy(perfilAspiranteActual?.seccion) ? "" : normalizarCodigoSeccion(perfilAspiranteActual?.seccion)
}

function construirContextoLocalAsistencia(fecha = new Date(), seccionRegistro = "") {
    const contexto = resolverContextoAsistencia(fecha, seccionRegistro)
    return {
        seccion: contexto.seccion || null,
        tipo_jornada: contexto.tipo_jornada || null,
        tipo_jornada_label: formatearTipoJornadaAmigable(contexto.jornada_label || contexto.tipo_jornada),
        modalidad: contexto.modalidad || null,
        modalidad_label: formatearModalidadAmigable(contexto.modalidad),
        estado_asistencia: null,
        estado_asistencia_label: "",
        regla_jornada_id: null,
        origen_contexto: "frontend_fallback",
        warnings: [],
        bloqueos: []
    }
}

function obtenerReglaSeccionCurso(seccionRegistro) {
    const codigo = normalizarCodigoSeccion(seccionRegistro)
    if (!codigo) return null
    return (cursoSecciones || []).find(item => normalizarCodigoSeccion(item?.seccion) === codigo) || null
}

function resolverContextoAsistencia(fecha = new Date(), seccionRegistro = "") {
    const ahoraLima = obtenerFechaHoraLima(fecha)
    const esDomingo = ahoraLima.weekday === "sunday"
    const seccionReal = normalizarCodigoSeccion(seccionRegistro)
    const regla = obtenerReglaSeccionCurso(seccionReal)
    return {
        fecha: ahoraLima.fecha,
        hora: ahoraLima.hora,
        timestamp: ahoraLima.timestamp,
        weekday: ahoraLima.weekday,
        esDomingo,
        seccion: seccionReal,
        tipo_jornada: obtenerTipoJornadaAspirante(ahoraLima.weekday),
        modalidad: esDomingo ? "PRESENCIAL" : normalizarModalidad(regla?.modalidad),
        jornada_label: esDomingo ? "DOMINICAL_GRUPAL" : "SECCION_REGULAR"
    }
}

function leerColaPendientes() {
    try {
        const raw = localStorage.getItem(OFFLINE_QUEUE_KEY)
        const data = raw ? JSON.parse(raw) : []
        return Array.isArray(data) ? data : []
    } catch (error) {
        console.warn("No se pudo leer la cola offline:", error)
        return []
    }
}

function guardarColaPendientes(cola) {
    try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(Array.isArray(cola) ? cola : []))
        return true
    } catch (error) {
        console.warn("No se pudo guardar la cola offline:", error)
        return false
    }
}

function construirClavePendiente(registro) {
    const tenantId = String(registro?.tenant_id || "").trim().toLowerCase()
    const cursoId = String(registro?.curso_id || "").trim()
    const dni = limpiarDni(registro?.dni)
    const fecha = String(registro?.fecha_local || "").trim()
    return `${tenantId}::${cursoId}::${dni}::${fecha}`
}

function actualizarContadorPendientes() {
    if (!pendingCounter) return
    const cantidad = leerColaPendientes().filter(item => item?.estado_sync === "pendiente").length
    pendingCounter.textContent = cantidad > 0
        ? (cantidad === 1
            ? "1 asistencia pendiente"
            : `${cantidad} asistencias pendientes`)
        : ""
    pendingCounter.hidden = cantidad === 0
    pendingCounter.classList.toggle("has-pending", cantidad > 0)
}

function agregarPendienteOffline(registro) {
    const cola = leerColaPendientes()
    const clave = construirClavePendiente(registro)
    const existe = cola.some(item => construirClavePendiente(item) === clave)

    if (existe) {
        actualizarContadorPendientes()
        return { ok: true, duplicate: true }
    }

    cola.push(registro)
    const guardado = guardarColaPendientes(cola)
    actualizarContadorPendientes()
    return { ok: guardado, duplicate: false }
}

function esErrorTransporteSupabase(error) {
    const texto = String(error?.message || error || "").toLowerCase()
    return !texto || esErrorConexion(texto)
}

function puedeGuardarOfflinePorContingencia() {
    return !!cursoQRValido && !!cursoValidadoEnSesion && !!tenantActivoId && !!(cursoActualId || 1)
}

function actualizarVisibilidadCamposLegacy() {
    if (!aspiranteLegacyFields) return
    aspiranteLegacyFields.hidden = tieneContextoRPCActivo()
}

function resetFormularioAsistencia() {
    cancelarRetornoPostRegistro()
    limpiarCamposAspirante()
    contextoAsistenciaActual = null
    seccion = ""
    seleccionarBotonSeccion("")
    actualizarVisibilidadCamposLegacy()
}

function programarRetornoPostRegistro() {
    cancelarRetornoPostRegistro()
    retornoPostRegistroTimer = window.setTimeout(() => {
        retornoPostRegistroTimer = 0
        const params = new URLSearchParams(window.location.search || "")
        const tokenCurso = obtenerCursoTokenDesdeURL()
        if (tenantActivoId) params.set("tenant", tenantActivoId)
        if (tokenCurso) params.set("curso", tokenCurso)
        params.set("v", String(Date.now()))
        window.location.replace(`/asistencia/index.html?${params.toString()}`)
    }, 3200)
}

function crearRegistroOffline({ dniRegistro, nombresValor, apellidosValor, seccionRegistro, modalidadRegistro, deviceId, gpsData = null }) {
    const contexto = contextoAsistenciaActual || construirContextoLocalAsistencia(new Date(), seccionRegistro)
    const fechaHora = resolverContextoAsistencia(new Date(), seccionRegistro)
    const nombreCompleto = `${String(nombresValor || "").trim()} ${String(apellidosValor || "").trim()}`
        .replace(/\s+/g, " ")
        .trim()

    return {
        dni: dniRegistro,
        nombre: nombreCompleto || nombresValor || null,
        tenant_id: tenantActivoId,
        curso_id: cursoActualId || 1,
        qr_token: obtenerCursoTokenDesdeURL(),
        fecha_local: fechaHora.fecha,
        hora_local: fechaHora.hora,
        timestamp_local: fechaHora.timestamp,
        latitud: gpsData?.latitud || null,
        longitud: gpsData?.longitud || null,
        seccion: contexto.seccion || null,
        tipo_jornada: contexto.tipo_jornada || fechaHora.tipo_jornada,
        modalidad: normalizarModalidad(modalidadRegistro) || contexto.modalidad || null,
        estado_asistencia: normalizarEstadoAsistencia(contexto.estado_asistencia),
        regla_jornada_id: contexto.regla_jornada_id || null,
        origen_contexto: contexto.origen_contexto || "frontend_fallback",
        device_id: deviceId || getDeviceId(),
        origen_registro: "offline",
        estado_sync: "pendiente",
        created_local_at: new Date().toISOString(),
        gps_latitud: gpsData?.latitud || null,
        gps_longitud: gpsData?.longitud || null,
        gps_accuracy: gpsData?.accuracy || null,
        gps_distancia_metros: gpsData?.distancia_metros || null,
        gps_estado: gpsData?.estado || null,
        gps_punto_tipo: gpsData?.punto_tipo || null,
        gps_punto_codigo: gpsData?.punto_codigo || null,
        gps_punto_nombre: gpsData?.punto_nombre || null,
        gps_modo: gpsData?.modo || null,
        gps_mensaje: gpsData?.mensaje || null
    }
}

async function sincronizarPendientes({ notificar = false } = {}) {
    if (sincronizacionPendientesEnCurso || !haySupabase() || !navigator.onLine) {
        actualizarContadorPendientes()
        return
    }

    const cola = leerColaPendientes()
    if (!cola.length) {
        actualizarContadorPendientes()
        return
    }

    sincronizacionPendientesEnCurso = true
    let sincronizados = 0
    const restantes = []

    try {
        for (const item of cola) {
            try {
                let response;
                if (item.qr_token) {
                    response = await supabaseClient.rpc("rpc_registrar_asistencia_v2", {
                        p_qr_token: String(item.qr_token).trim(),
                        p_dni: limpiarDni(item.dni),
                        p_timestamp: item.timestamp_local || item.created_local_at || new Date().toISOString(),
                        p_device_id: String(item.device_id || getDeviceId()).trim(),
                        p_latitud: item.latitud == null ? null : Number(item.latitud),
                        p_longitud: item.longitud == null ? null : Number(item.longitud),
                        p_origen_registro: "offline",
                        p_gps_latitud: item.gps_latitud == null ? null : Number(item.gps_latitud),
                        p_gps_longitud: item.gps_longitud == null ? null : Number(item.gps_longitud),
                        p_gps_accuracy: item.gps_accuracy == null ? null : Number(item.gps_accuracy),
                        p_gps_distancia_metros: item.gps_distancia_metros == null ? null : Number(item.gps_distancia_metros),
                        p_gps_estado: item.gps_estado || null,
                        p_gps_punto_tipo: item.gps_punto_tipo || null,
                        p_gps_punto_codigo: item.gps_punto_codigo || null,
                        p_gps_punto_nombre: item.gps_punto_nombre || null,
                        p_gps_modo: item.gps_modo || null,
                        p_gps_mensaje: item.gps_mensaje || null
                    });
                } else {
                    response = await supabaseClient.rpc("rpc_registrar_asistencia", {
                        p_dni: limpiarDni(item?.dni),
                        p_tenant_id: String(item?.tenant_id || "").trim(),
                        p_seccion: String(item?.seccion || "GENERAL").trim() || "GENERAL",
                        p_latitud: item?.latitud == null ? 0 : Number(item.latitud),
                        p_longitud: item?.longitud == null ? 0 : Number(item.longitud),
                        p_device_id: String(item?.device_id || getDeviceId()).trim(),
                        p_timestamp_local: item?.timestamp_local || item?.created_local_at || new Date().toISOString(),
                        p_curso_id: Number(item?.curso_id || 1) || 1,
                        p_origen_registro: String(item?.origen_registro || "offline").trim() || "offline"
                    });
                }

                const errorText = error ? String(error.message || error) : ""
                const isDuplicate = data?.code === "asistencia_duplicada" ||
                                    /duplicada|ya registró/i.test(String(data?.message || errorText || ""))

                if (error) {
                    if (esErrorConexion(error)) {
                        restantes.push(item)
                    } else if (isDuplicate) {
                        sincronizados += 1
                    } else {
                        console.warn("Error permanente en sincronización offline, descartando registro:", errorText)
                    }
                    continue
                }

                if (!data?.success) {
                    if (isDuplicate) {
                        sincronizados += 1
                    } else {
                        restantes.push(item)
                    }
                    continue
                }

                sincronizados += 1
            } catch (error) {
                if (esErrorConexion(error)) {
                    restantes.push(item)
                } else {
                    console.warn("Excepción permanente en sincronización offline, descartando:", error)
                }
            }
        }
    } finally {
        guardarColaPendientes(restantes)
        sincronizacionPendientesEnCurso = false
        actualizarContadorPendientes()
    }

    if (notificar && sincronizados > 0) {
        setMensaje(
            sincronizados === 1
                ? "✅ Asistencia sincronizada correctamente."
                : `✅ ${sincronizados} asistencias sincronizadas correctamente.`,
            "ok"
        )
        return
    }

    if (notificar && !sincronizados && restantes.length > 0) {
        setMensaje("No se pudo sincronizar. Se intentará nuevamente cuando haya conexión.", "warning")
    }
}

async function guardarAsistenciaOffline({ dniRegistro, nombresValor, apellidosValor, seccionRegistro, modalidadRegistro, motivo, gpsData = null }) {
    if (!puedeGuardarOfflinePorContingencia()) {
        setMensaje(motivo || "⚠ No se pudo registrar la asistencia en este momento.", "error")
        return false
    }

    const resultado = agregarPendienteOffline(crearRegistroOffline({
        dniRegistro,
        nombresValor,
        apellidosValor,
        seccionRegistro,
        modalidadRegistro,
        deviceId: getDeviceId(),
        gpsData
    }))

    if (!resultado.ok) {
        setMensaje("Ocurrió un problema al procesar la solicitud.", "error")
        return false
    }

    if (resultado.duplicate) {
        setMensaje("Sin conexión. Esta asistencia ya estaba guardada en este dispositivo.", "warning")
    } else {
        setMensaje("Sin conexión. Asistencia guardada en este dispositivo. Se sincronizará al volver a abrir asistIA con internet.", "warning")
    }

    resetFormularioAsistencia()
    return true
}

function extraerMensajesContexto(items) {
    if (!Array.isArray(items)) return []
    const seen = new Set()
    return items
        .filter(item => !debeOcultarMensajePublico(item))
        .filter(item => {
            const key = construirClaveMensajePublico(item)
            if (!key || seen.has(key)) return false
            seen.add(key)
            return true
        })
        .map(item => String(item?.message || item || "").trim())
        .filter(Boolean)
}

async function resolverContextoAsistenciaRPC(dniLimpio) {
    if (!haySupabase() || !tenantActivoId || !cursoQRValido) {
        debugContextLog("resolverContextoAsistenciaRPC: skip precondicion", {
            haySupabase: haySupabase(),
            tenantActivoId: !!tenantActivoId,
            cursoQRValido,
            dni: dniLimpio
        })
        return null
    }
    const tokenCurso = obtenerCursoTokenDesdeURL()
    debugContextLog("resolverContextoAsistenciaRPC: inicio", {
        dni: dniLimpio,
        tokenCursoExiste: !!tokenCurso,
        tenantActivoId,
        cursoQRValido,
        cursoActualId
    })
    if (!tokenCurso) {
        debugContextLog("resolverContextoAsistenciaRPC: fallback por token ausente", { dni: dniLimpio })
        return null
    }

    try {
        const { data, error } = await supabaseClient.rpc("rpc_resolver_contexto_asistencia", {
            p_qr_token: tokenCurso,
            p_dni: dniLimpio,
            p_timestamp: new Date().toISOString()
        })

        debugContextLog("resolverContextoAsistenciaRPC: respuesta", {
            dni: dniLimpio,
            error: error ? String(error.message || error) : null,
            data
        })

        if (error) {
            if (/does not exist|42883|rpc_resolver_contexto_asistencia/i.test(String(error.message || ""))) {
                debugContextLog("resolverContextoAsistenciaRPC: fallback por RPC inexistente", {
                    dni: dniLimpio,
                    error: String(error.message || error)
                })
                return null
            }
            debugContextLog("resolverContextoAsistenciaRPC: error no recuperable", {
                dni: dniLimpio,
                error: String(error.message || error)
            })
            throw error
        }

        debugContextLog("resolverContextoAsistenciaRPC: retorno final", {
            dni: dniLimpio,
            success: !!data?.success,
            permitido: !!data?.permitido
        })
        return data && typeof data === "object" ? data : null
    } catch (error) {
        if (esErrorConexion(error)) {
            debugContextLog("resolverContextoAsistenciaRPC: fallback por error de red", {
                dni: dniLimpio,
                error: String(error?.message || error)
            })
            return null
        }
        debugContextLog("resolverContextoAsistenciaRPC: throw catch final", {
            dni: dniLimpio,
            error: String(error?.message || error)
        })
        throw error
    }
}

function aplicarContextoResueltoEnFormulario(contexto) {
    debugContextLog("aplicarContextoResueltoEnFormulario: entrada", { contexto })
    if (!contexto || typeof contexto !== "object") return

    const aspirante = contexto.aspirante && typeof contexto.aspirante === "object"
        ? contexto.aspirante
        : null

    if (aspirante) {
        nombres.value = String(aspirante.nombres || nombres.value || "").trim()
        apellidos.value = String(aspirante.apellidos || apellidos.value || "").trim()
        ubo.value = String(aspirante.ubo || ubo.value || "").trim()
        aplicarReadonlyVisual(nombres, true)
        aplicarReadonlyVisual(apellidos, true)
        aplicarReadonlyVisual(ubo, true)
    }

    const seccionContexto = normalizarCodigoSeccion(contexto.seccion)
    if (seccionContexto) {
        perfilAspiranteActual = { dni: dniMovil || "", seccion: seccionContexto }
        seccion = seccionContexto
        seleccionarBotonSeccion(seccion)
    }

    contextoAsistenciaActual = {
        aspirante: aspirante
            ? {
                dni: limpiarDni(aspirante.dni || dniMovil || ""),
                nombres: String(aspirante.nombres || "").trim(),
                apellidos: String(aspirante.apellidos || "").trim(),
                ubo: String(aspirante.ubo || "").trim()
            }
            : null,
        seccion: seccionContexto || null,
        tipo_jornada: String(contexto.jornada_codigo || "").trim().toUpperCase() || null,
        tipo_jornada_label: String(contexto.jornada_label || "").trim() || formatearTipoJornadaAmigable(contexto.jornada_codigo),
        modalidad: normalizarModalidad(contexto.modalidad),
        modalidad_label: String(contexto.modalidad_label || "").trim() || formatearModalidadAmigable(contexto.modalidad),
        estado_asistencia: normalizarEstadoAsistencia(contexto.estado_asistencia),
        estado_asistencia_label: String(contexto.estado_asistencia || "").trim()
            ? formatearEstadoAsistenciaAmigable(contexto.estado_asistencia)
            : "",
        regla_jornada_id: contexto.regla_jornada_id || null,
        origen_contexto: String(contexto.origen_contexto || "rpc_resolver_contexto_asistencia").trim(),
        warnings: Array.isArray(contexto.warnings) ? contexto.warnings : [],
        bloqueos: Array.isArray(contexto.bloqueos) ? contexto.bloqueos : []
    }
    actualizarVisibilidadCamposLegacy()
    actualizarDebugContextGlobal()
    debugContextLog("aplicarContextoResueltoEnFormulario: contexto aplicado", {
        contextoAsistenciaActual,
        hasRPC: tieneContextoRPCActivo()
    })
}

function construirResumenContextualHTML({ title, nombreCompleto, contexto, seccionDetectada }) {
    const institucion = String(tenantActivoId || "").trim().replace(/-/g, " ").toUpperCase() || "Institución no detectada"
    const seccionValor = contexto?.seccion || seccionDetectada || "Pendiente de resolver"
    const jornadaValor = contexto?.tipo_jornada_label || formatearTipoJornadaAmigable(contexto?.jornada_label || contexto?.tipo_jornada) || "Pendiente de resolver"
    const modalidadValor = contexto?.modalidad_label || formatearModalidadAmigable(contexto?.modalidad) || "Pendiente de resolver"
    const estadoValor = contexto?.estado_asistencia
        ? (contexto?.estado_asistencia_label || formatearEstadoAsistenciaAmigable(contexto.estado_asistencia))
        : "Pendiente de resolver"

    return `
        <div class="context-card">
            <div class="context-card-head">
                <p class="context-title">${escapeHTML(title)}</p>
                ${nombreCompleto ? `<p class="context-person">${escapeHTML(nombreCompleto)}</p>` : ""}
            </div>
            <div class="context-grid">
                <div class="context-item">
                    <span class="context-item-label">Institución</span>
                    <span class="context-item-value">${escapeHTML(institucion)}</span>
                </div>
                <div class="context-item">
                    <span class="context-item-label">Sección</span>
                    <span class="context-item-value">${escapeHTML(seccionValor)}</span>
                </div>
                <div class="context-item">
                    <span class="context-item-label">Jornada asignada</span>
                    <span class="context-item-value">${escapeHTML(jornadaValor)}</span>
                </div>
                <div class="context-item">
                    <span class="context-item-label">Modalidad</span>
                    <span class="context-item-value">${escapeHTML(modalidadValor)}</span>
                </div>
                <div class="context-item">
                    <span class="context-item-label">Estado del registro</span>
                    <span class="context-item-value">${escapeHTML(estadoValor)}</span>
                </div>
            </div>
        </div>
    `
}

async function resolverCursoPorToken(token) {
    cursoQRValido = false
    ultimoEstadoCurso = { code: "invalid_token", message: "Acceso no válido. Escanee el código QR oficial del curso." }
    if (!token) return false
    if (!haySupabase() || !tenantActivoId) {
        ultimoEstadoCurso = { code: "supabase_unavailable", message: "No se pudo cargar la información." }
        return false
    }

    try {
        const { data, error } = await supabaseClient.rpc("rpc_validar_curso_qr", {
            p_qr_token: token,
            p_tenant_id: tenantActivoId
        })

        if (error) {
            ultimoEstadoCurso = !navigator.onLine || esErrorTransporteSupabase(error)
                ? { code: "offline", message: "No se pudo conectar con asistIA. Verifica tu conexión e inténtalo nuevamente." }
                : { code: "rpc_failed", message: "No se pudo cargar la información." }
            cursoQRValido = false
            return false
        }

        if (!data?.success) {
            ultimoEstadoCurso = { code: "invalid_token", message: "Acceso no válido. Escanee el código QR oficial del curso." }
            cursoQRValido = false
            return false
        }

        cursoActualId = Number(data.curso_id || 1) || 1
        cursoQRValido = true
        cursoValidadoEnSesion = true
        ultimoEstadoCurso = { code: "ok", message: "" }
        return true
    } catch (e) {
        ultimoEstadoCurso = !navigator.onLine || esErrorTransporteSupabase(e)
            ? { code: "offline", message: "No se pudo conectar con asistIA. Verifica tu conexión e inténtalo nuevamente." }
            : { code: "unexpected", message: "No se pudo cargar la información." }
        cursoQRValido = false
        return false
    }
}

async function resolverCursoDesdeURL() {
    const token = obtenerCursoTokenDesdeURL()
    if (!token) {
        cursoQRValido = false
        return false
    }
    return resolverCursoPorToken(token)
}

function normalizarCursoBaseSupabase(row) {
    return {
        id: Number(row?.id || 1) || 1,
        nombre: String(row?.nombre || "").trim(),
        fecha_inicio: row?.fecha_inicio || null,
        fecha_fin: row?.fecha_fin || null
    }
}

async function cargarCursoBaseDesdeSupabase() {
    if (!haySupabase()) return null

    let q = withTenantScope(
        supabaseClient
            .from("cursos")
            .select("id,nombre,tenant_id,estado,fecha_inicio,fecha_fin")
    )

    const { data, error } = await q
        .eq("estado", "activo")
        .eq("id", cursoActualId || 1)
        .limit(1)

    if (error) {
        if (esTablaNoExiste(error)) return null
        return null
    }

    const row = Array.isArray(data) ? data[0] : null
    return row ? normalizarCursoBaseSupabase(row) : null
}

async function cargarConfigCurso() {
    if (!haySupabase()) return

    const cursoBase = await cargarCursoBaseDesdeSupabase()

    const { data: configData, error: configError } = await withTenantScope(
        supabaseClient.from("curso_configuracion").select("*")
    ).maybeSingle()

    cursoConfigCache = configError
        ? (cursoBase ? {
            nombre_curso: cursoBase.nombre || "",
            fecha_inicio: cursoBase.fecha_inicio || null,
            fecha_fin: cursoBase.fecha_fin || null,
            gps_activo: false,
            radio_m: 50
        } : null)
        : (configData ? Object.assign({}, configData, {
            nombre_curso: configData.nombre_curso || cursoBase?.nombre || ""
        }) : (cursoBase ? {
            nombre_curso: cursoBase.nombre || "",
            fecha_inicio: cursoBase.fecha_inicio || null,
            fecha_fin: cursoBase.fecha_fin || null,
            gps_activo: false,
            radio_m: 50
        } : null))

    let dataSecciones = []
    let errorSecciones = null

    ;({ data: dataSecciones, error: errorSecciones } = await withTenantScope(
        supabaseClient
            .from("curso_secciones")
            .select("seccion, modalidad, dias, hora_inicio, curso_id, tenant_id")
            .eq("curso_id", cursoActualId || 1)
            .order("seccion", { ascending: true })
    ))

    if (errorSecciones) {
        console.warn("No se pudo cargar curso_secciones:", errorSecciones.message || errorSecciones)
    }

    if (errorSecciones && /curso_id/i.test(String(errorSecciones.message || ""))) {
        const fallback = await withTenantScope(
            supabaseClient
                .from("curso_secciones")
                .select("seccion, modalidad, dias, hora_inicio, tenant_id")
                .order("seccion", { ascending: true })
        )
        dataSecciones = fallback.data || []
        errorSecciones = fallback.error
    }

    cursoSecciones = errorSecciones ? [] : (dataSecciones || []).map(item => ({
        seccion: normalizarCodigoSeccion(item.seccion),
        modalidad: normalizarModalidad(item.modalidad || "PRESENCIAL"),
        dias: Array.isArray(item.dias) ? item.dias : [],
        hora_inicio: item.hora_inicio || ""
    }))

    if (cursoConfigCache && tenantActivoId) {
        try {
            localStorage.setItem(
                `asistia_gps_config_${tenantActivoId}_${cursoActualId || 1}`,
                JSON.stringify({ oper_gps_modo: cursoConfigCache.oper_gps_modo || "desactivado" })
            );
        } catch (e) {
            console.warn("No se pudo cachear gps config en localStorage:", e);
        }
    }
}

function seleccionarBotonSeccion(valor) {
    document.querySelectorAll(".mobile-section-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.seccion === valor)
    })
}

function setSeccion(valor) {
    seccion = normalizarCodigoSeccion(valor)
    seleccionarBotonSeccion(seccion)
}

function esDomingoLima(fecha = new Date()) {
    try {
        const weekday = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Lima",
            weekday: "long"
        }).format(fecha)
        return String(weekday || "").toLowerCase() === "sunday"
    } catch (e) {
        return fecha.getDay() === 0
    }
}

function renderSeccionesMovil() {
    if (!mobileSectionsContainer) return

    actualizarVisibilidadCamposLegacy()
    const seccionDetectada = obtenerSeccionAspiranteDetectada()
    const contextoRemoto = contextoAsistenciaActual
    const usarContextoRPC = tieneContextoRPCActivo()
    debugContextLog("renderSeccionesMovil: inicio", {
        hasRPC: usarContextoRPC,
        seccionDetectada,
        contextoRemoto
    })
    seccion = normalizarCodigoSeccion((usarContextoRPC ? contextoRemoto?.seccion : "") || seccionDetectada) || ""
    seleccionarBotonSeccion(seccion)
    mobileSectionsContainer.innerHTML = ""
    const contexto = usarContextoRPC
        ? contextoRemoto
        : (contextoRemoto || construirContextoLocalAsistencia(new Date(), seccionDetectada))
    const title = cursoConfigCache?.nombre_curso || "Curso"
    const nombreCompleto = `${String(nombres?.value || "").trim()} ${String(apellidos?.value || "").trim()}`
        .replace(/\s+/g, " ")
        .trim()
    let html = construirResumenContextualHTML({
        title,
        nombreCompleto,
        contexto,
        seccionDetectada
    })

    if (usarContextoRPC) {
        mobileSectionsContainer.innerHTML = html
        debugContextLog("renderSeccionesMovil: render RPC", {
            hasRPC: usarContextoRPC,
            htmlPreview: String(mobileSectionsContainer.innerHTML || "").replace(/\s+/g, " ").slice(0, 280)
        })
        return
    }

    if (!cursoSecciones.length) {
        if (!contexto?.seccion && !seccionDetectada) {
            html += `<p class="context-note">No hay secciones configuradas para este curso.</p>`
        }
        mobileSectionsContainer.innerHTML = html
        debugContextLog("renderSeccionesMovil: render sin secciones", {
            hasRPC: usarContextoRPC,
            htmlPreview: String(mobileSectionsContainer.innerHTML || "").replace(/\s+/g, " ").slice(0, 280)
        })
        return
    }

    if (contextoRemoto?.seccion || seccionDetectada) {
        mobileSectionsContainer.innerHTML = html
        debugContextLog("renderSeccionesMovil: render legacy sin selector", {
            hasRPC: usarContextoRPC,
            htmlPreview: String(mobileSectionsContainer.innerHTML || "").replace(/\s+/g, " ").slice(0, 280)
        })
        return
    }

    html += contexto.esDomingo
        ? `<p class="context-note">Selecciona tu sección de aspirante. Compatibilidad temporal para jornada dominical.</p>`
        : `<p class="context-note">Selecciona tu sección de aspirante para completar el registro.</p>`

    cursoSecciones.forEach(sec => {
        const dias = Array.isArray(sec.dias) ? sec.dias.join(", ") : ""
        const modalidadLabel = formatearModalidadAmigable(sec.modalidad)
        const label = `Sección ${sec.seccion}${dias ? ` · ${dias}` : ""}${modalidadLabel ? ` · ${modalidadLabel}` : ""}`
        html += `<button class="mobile-section-btn" type="button" data-seccion="${sec.seccion}">${label}</button>`
    })

    mobileSectionsContainer.innerHTML = html
    mobileSectionsContainer.querySelectorAll(".mobile-section-btn").forEach(btn => {
        btn.addEventListener("click", () => setSeccion(btn.dataset.seccion || ""))
    })
    debugContextLog("renderSeccionesMovil: render legacy con selector", {
        hasRPC: usarContextoRPC,
        secciones: cursoSecciones.map(sec => sec.seccion),
        htmlPreview: String(mobileSectionsContainer.innerHTML || "").replace(/\s+/g, " ").slice(0, 280)
    })
}

async function ingresarMovilInicio() {
    cancelarRetornoPostRegistro()
    const dniLimpio = limpiarDni(mobileDniInicio?.value)
    if (mobileDniInicio) mobileDniInicio.value = dniLimpio
    debugContextLog("ingresarMovilInicio: inicio", {
        dni: dniLimpio,
        cursoQRValido,
        tenantActivoId,
        cursoActualId
    })

    if (!dniLimpio) {
        setMensaje("⚠ Ingresa tu DNI para continuar", "error")
        return
    }

    if (!cursoQRValido) {
        setMensaje("Acceso no válido. Escanee el código QR oficial del curso.", "error")
        return
    }

    dniMovil = dniLimpio
    try {
        clearTimeout(debounceTimerAutocompletar)
        await cargarConfigCurso()
        debugContextLog("ingresarMovilInicio: config cargada", {
            cursoSecciones: cursoSecciones.map(sec => sec.seccion),
            cursoConfig: cursoConfigCache ? { nombre_curso: cursoConfigCache.nombre_curso || "" } : null
        })
        contextoAsistenciaActual = null
        const contextoRPC = await resolverContextoAsistenciaRPC(dniLimpio)

        if (contextoRPC?.success === true) {
            if (!contextoRPC.permitido) {
                const msgBloqueo = String(contextoRPC.message || extraerMensajesContexto(contextoRPC.bloqueos)[0] || "No se pudo resolver el contexto de asistencia.").trim()
                formulario.style.display = "none"
                if (stepIngreso) stepIngreso.style.display = "flex"
                setMensaje(msgBloqueo, "error")
                return
            }

            aplicarContextoResueltoEnFormulario(contextoRPC)
            const friendlyWarnings = obtenerMensajesAdvertenciaAmigables(contextoRPC)
            if (friendlyWarnings.length > 0) {
                setMensaje(friendlyWarnings.join(" | "), "warning")
            } else {
                setMensaje("")
            }
        } else {
            debugContextLog("ingresarMovilInicio: fallback sin contexto RPC usable", {
                dni: dniLimpio,
                contextoRPC
            })
            setMensaje("")
        }

        renderSeccionesMovil()
        debugContextLog("ingresarMovilInicio: post-render", {
            hasRPC: tieneContextoRPCActivo(),
            contextoAsistenciaActual,
            htmlPreview: String(mobileSectionsContainer?.innerHTML || "").replace(/\s+/g, " ").slice(0, 280)
        })
        if (stepIngreso) stepIngreso.style.display = "none"
        formulario.style.display = "flex"
    } catch (error) {
        debugContextLog("ingresarMovilInicio: error", {
            dni: dniLimpio,
            error: String(error?.message || error)
        })
        console.error("Error preparando formulario de asistencia:", error)
        setMensaje("No se pudo cargar la información.", "error")
    }
}

function volverInicio() {
    cancelarRetornoPostRegistro()
    formulario.style.display = "none"
    if (mobileDniInicio) mobileDniInicio.value = dniMovil
    mostrarPasoMovil("ingreso")
    setMensaje("")
}

function getDeviceId() {
    let id = localStorage.getItem("dev")
    if (!id) {
        id = `dev-${Math.random().toString(36).slice(2, 12)}`
        localStorage.setItem("dev", id)
    }
    return id
}

async function procesarAutocompletadoDni(dniValue) {
    const dniLimpio = limpiarDni(dniValue)
    const preservarContextoRPC = tieneContextoRPCActivo() && contextoCorrespondeADni(dniLimpio)
    debugContextLog("procesarAutocompletadoDni: input", {
        dni: dniLimpio,
        preservarContextoRPC,
        hasRPC: tieneContextoRPCActivo()
    })

    if (mobileDniInicio && document.activeElement === mobileDniInicio) {
        mobileDniInicio.value = dniLimpio
    }

    if (dniLimpio.length !== 8) {
        if (!preservarContextoRPC) contextoAsistenciaActual = null
        limpiarCamposAspirante(!preservarContextoRPC)
        debugContextLog("procesarAutocompletadoDni: dni incompleto", {
            dni: dniLimpio,
            preservarContextoRPC
        })
        setMensaje("")
        return
    }

    clearTimeout(debounceTimerAutocompletar)
    debounceTimerAutocompletar = window.setTimeout(async () => {
        if (!haySupabase() || !tenantActivoId) return

        try {
            debugContextLog("procesarAutocompletadoDni: lookup inicio", {
                dni: dniLimpio,
                tenantActivoId,
                cursoActualId
            })
            const cursoEsperado = Number(cursoActualId || 1) || 1
            let data = null
            let error = null

            ;({ data, error } = await supabaseClient
                .from("aspirantes")
                .select("nombres, apellidos, ubo, curso_id, seccion")
                .eq("dni", dniLimpio)
                .eq("tenant_id", tenantActivoId)
                .single())

            if (error && /seccion/i.test(String(error.message || ""))) {
                const fallback = await supabaseClient
                    .from("aspirantes")
                    .select("nombres, apellidos, ubo, curso_id")
                    .eq("dni", dniLimpio)
                    .eq("tenant_id", tenantActivoId)
                    .single()
                data = fallback.data
                error = fallback.error
            }

            if (error || !data) {
                if (!preservarContextoRPC) contextoAsistenciaActual = null
                perfilAspiranteActual = { dni: "", seccion: "" }
                limpiarCamposAspirante(!preservarContextoRPC)
                debugContextLog("procesarAutocompletadoDni: aspirante no encontrado", {
                    dni: dniLimpio,
                    error: error ? String(error.message || error) : null,
                    preservarContextoRPC
                })
                setMensaje("⚠ El DNI ingresado no existe en el padrón de la institución.", "warning")
                return
            }

            const cursoAspirante = data.curso_id == null ? null : Number(data.curso_id)

            if (cursoAspirante != null && cursoAspirante !== cursoEsperado) {
                if (!preservarContextoRPC) contextoAsistenciaActual = null
                perfilAspiranteActual = { dni: "", seccion: "" }
                validacionCursoAspirante = {
                    dni: dniLimpio,
                    permitido: false,
                    legacy: false,
                    bloqueado: true
                }
                limpiarCamposAspirante(false)
                debugContextLog("procesarAutocompletadoDni: curso distinto", {
                    dni: dniLimpio,
                    cursoAspirante,
                    cursoEsperado
                })
                setMensaje("⚠ El aspirante no pertenece al curso de este QR.", "error")
                return
            }

            if (cursoAspirante == null) {
                console.warn("Aspirante sin curso_id; compatibilidad legacy aplicada para DNI:", dniLimpio)
            }

            validacionCursoAspirante = {
                dni: dniLimpio,
                permitido: true,
                legacy: cursoAspirante == null,
                bloqueado: false
            }
            perfilAspiranteActual = {
                dni: dniLimpio,
                seccion: esSeccionLegacy(data.seccion) ? "" : normalizarCodigoSeccion(data.seccion)
            }
            if (!preservarContextoRPC) contextoAsistenciaActual = null

            nombres.value = data.nombres || ""
            apellidos.value = data.apellidos || ""
            ubo.value = data.ubo || ""

            nombres.readOnly = true
            apellidos.readOnly = true
            ubo.readOnly = true
            nombres.style.backgroundColor = "#f3f6fb"
            apellidos.style.backgroundColor = "#f3f6fb"
            ubo.style.backgroundColor = "#f3f6fb"
            if (formulario?.style.display !== "none" && !preservarContextoRPC) {
                renderSeccionesMovil()
            }
            debugContextLog("procesarAutocompletadoDni: lookup exitoso", {
                dni: dniLimpio,
                seccionPerfil: perfilAspiranteActual.seccion,
                preservarContextoRPC,
                hasRPC: tieneContextoRPCActivo()
            })
            setMensaje("")
        } catch (e) {
            console.error("Error validando DNI de aspirante:", e)
            if (!preservarContextoRPC) contextoAsistenciaActual = null
            perfilAspiranteActual = { dni: "", seccion: "" }
            limpiarCamposAspirante(!preservarContextoRPC)
            debugContextLog("procesarAutocompletadoDni: error", {
                dni: dniLimpio,
                preservarContextoRPC,
                error: String(e?.message || e)
            })
            setMensaje(mensajeAmigable(e, "No se pudo cargar la información."), "error")
        }
    }, 300)
}

function limpiarCamposAspirante(resetValidacion = true) {
    nombres.value = ""
    apellidos.value = ""
    ubo.value = ""

    aplicarReadonlyVisual(nombres, false)
    aplicarReadonlyVisual(apellidos, false)
    aplicarReadonlyVisual(ubo, false)

    if (resetValidacion) {
        validacionCursoAspirante = { dni: "", permitido: true, legacy: false, bloqueado: false }
        perfilAspiranteActual = { dni: "", seccion: "" }
        contextoAsistenciaActual = null
    }
    actualizarVisibilidadCamposLegacy()
}

function esRpcV2NoDisponible(error) {
    const texto = String(error?.message || error || "")
    return /rpc_registrar_asistencia_v2|does not exist|42883/i.test(texto)
}

function construirWarningsRegistro(data, contextoAsistencia) {
    const warnings = extraerMensajesContexto(data?.warnings)
    const estado = String(
        data?.contexto?.estado_asistencia
        || contextoAsistencia?.estado_asistencia
        || ""
    ).trim().toUpperCase()

    if (estado === "TARDANZA") {
        warnings.unshift("Registro en tardanza")
    } else if (estado === "FUERA_DE_HORARIO") {
        warnings.unshift("Registro fuera de horario")
    }

    return deduplicarMensajes(warnings.filter(Boolean))
}

async function intentarRegistrarAsistenciaV2({ dniRegistro, deviceId, gpsData = null }) {
    const tokenCurso = obtenerCursoTokenDesdeURL()

    if (!tokenCurso) {
        throw new Error("QR/token de curso no disponible para rpc_registrar_asistencia_v2.")
    }

    const timestamp = new Date().toISOString()

    debugContextLog("guardarAsistencia: intento v2", {
        dni: dniRegistro,
        tokenCursoExiste: !!tokenCurso,
        deviceId,
        cursoActualId,
        tenantActivoId,
        gpsData
    })

    const { data, error } = await supabaseClient.rpc("rpc_registrar_asistencia_v2", {
        p_qr_token: tokenCurso,
        p_dni: dniRegistro,
        p_timestamp: timestamp,
        p_device_id: deviceId,
        p_latitud: gpsData?.latitud || null,
        p_longitud: gpsData?.longitud || null,
        p_origen_registro: "mobile_public",
        p_gps_latitud: gpsData?.latitud || null,
        p_gps_longitud: gpsData?.longitud || null,
        p_gps_accuracy: gpsData?.accuracy || null,
        p_gps_distancia_metros: gpsData?.distancia_metros || null,
        p_gps_estado: gpsData?.estado || null,
        p_gps_punto_tipo: gpsData?.punto_tipo || null,
        p_gps_punto_codigo: gpsData?.punto_codigo || null,
        p_gps_punto_nombre: gpsData?.punto_nombre || null,
        p_gps_modo: gpsData?.modo || null,
        p_gps_mensaje: gpsData?.mensaje || null
    })

    debugContextLog("guardarAsistencia: respuesta v2", {
        dni: dniRegistro,
        error: error ? String(error.message || error) : null,
        data
    })

    if (error) throw error

    return data
}

async function intentarRegistrarAsistenciaLegacy({ dniRegistro, seccionRegistro, deviceId }) {
    debugContextLog("guardarAsistencia: intento legacy", {
        dni: dniRegistro,
        seccionRegistro,
        deviceId,
        cursoActualId,
        tenantActivoId
    })

    const { data, error } = await supabaseClient.rpc("rpc_registrar_asistencia", {
        p_dni: dniRegistro,
        p_tenant_id: tenantActivoId,
        p_seccion: seccionRegistro,
        p_latitud: 0,
        p_longitud: 0,
        p_device_id: deviceId,
        p_timestamp_local: new Date().toISOString(),
        p_curso_id: cursoActualId || 1,
        p_origen_registro: "mobile_public_legacy"
    })

    debugContextLog("guardarAsistencia: respuesta legacy", {
        dni: dniRegistro,
        error: error ? String(error.message || error) : null,
        data
    })

    if (error) throw error

    return data
}

function calcularDistanciaGpsMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

let ultimoDiagnosticoGps = null;

function setEstadoCargandoBotonRegistrar(cargando, texto = "Obteniendo ubicación...") {
    const btn = document.getElementById("btnRegistrar");
    if (!btn) return;
    if (cargando) {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        if (!btn.dataset.originalText) {
            btn.dataset.originalText = btn.textContent || "Registrar asistencia";
        }
        btn.textContent = texto;
    } else {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.textContent = btn.dataset.originalText || "Registrar asistencia";
    }
}

function registrarDiagnosticoGps({ estado, codigo = null, precision = null, distanciaMetros = null, radioPermitido = null, duracionMs = null }) {
    ultimoDiagnosticoGps = {
        estado: String(estado || "GPS_NO_DISPONIBLE"),
        codigo: codigo != null ? Number(codigo) : null,
        precision: precision != null ? Number(precision) : null,
        distanciaMetros: distanciaMetros != null ? Number(distanciaMetros) : null,
        radioPermitido: radioPermitido != null ? Number(radioPermitido) : null,
        duracionMs: duracionMs != null ? Number(duracionMs) : null,
        fechaHora: new Date().toISOString()
    };
    if (typeof window !== "undefined") {
        window.ultimoDiagnosticoGps = ultimoDiagnosticoGps;
    }
    return ultimoDiagnosticoGps;
}

function obtenerDetalleErrorGps(geoError) {
    const code = Number(geoError?.code);
    if (code === 1) {
        return {
            estado: "PERMISSION_DENIED",
            codigo: 1,
            mensaje: "⚠ No se pudo acceder a tu ubicación porque el permiso está desactivado o fue rechazado. Habilita la ubicación para este sitio desde la configuración de Chrome o Safari y vuelve a intentarlo."
        };
    }
    if (code === 2) {
        return {
            estado: "POSITION_UNAVAILABLE",
            codigo: 2,
            mensaje: "⚠ No se pudo obtener la señal de ubicación. Verifica que la ubicación/GPS de tu celular esté activada e inténtalo nuevamente."
        };
    }
    if (code === 3) {
        return {
            estado: "TIMEOUT",
            codigo: 3,
            mensaje: "⚠ La ubicación tardó demasiado en responder. Inténtalo nuevamente y, de ser posible, colócate en un lugar abierto."
        };
    }
    return {
        estado: "GEOLOCATION_NO_SOPORTADA",
        codigo: 0,
        mensaje: "⚠ Este navegador no permite obtener la ubicación. Abre el QR desde Chrome en Android o Safari en iPhone."
    };
}

function obtenerUbicacionNavegador() {
    const inicioMs = Date.now();
    return new Promise((resolve, reject) => {
        if (!navigator || !navigator.geolocation) {
            const err = new Error("GEOLOCATION_NO_SOPORTADA");
            err.code = 0;
            err.duracionMs = Date.now() - inicioMs;
            reject(err);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const duracionMs = Date.now() - inicioMs;
                pos.coords.duracionMs = duracionMs;
                resolve(pos.coords);
            },
            (err) => {
                err.duracionMs = Date.now() - inicioMs;
                reject(err);
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
        );
    });
}

async function guardarAsistencia() {
    try {
        ultimoGpsData = null
        ultimoResultadoRegistro = null
        const dniRegistro = limpiarDni(dniMovil || mobileDniInicio?.value)
        const nombresValor = String(nombres.value || "").trim()
        const apellidosValor = String(apellidos.value || "").trim()
        const uboValor = String(ubo.value || "").replace(/\D/g, "")
        const seccionBase = seccion || obtenerSeccionAspiranteDetectada()
        const contextoAsistencia = contextoAsistenciaActual || construirContextoLocalAsistencia(new Date(), seccionBase)
        const seccionRegistro = normalizarCodigoSeccion(contextoAsistencia.seccion || seccionBase)
        const deviceId = getDeviceId()

        if (!dniRegistro) {
            setMensaje("⚠ DNI no válido", "error")
            return
        }

        if (!cursoQRValido) {
            setMensaje("Acceso no válido. Escanee el código QR oficial del curso.", "error")
            return
        }

        if (validacionCursoAspirante?.dni === dniRegistro && validacionCursoAspirante?.bloqueado) {
            setMensaje("⚠ El aspirante no pertenece al curso de este QR.", "error")
            return
        }

        if (!nombresValor || !apellidosValor) {
            setMensaje("⚠ Completa nombres y apellidos", "error")
            return
        }

        if (!uboValor) {
            setMensaje("⚠ UBO debe ser numérico", "error")
            return
        }

        const isTodosAspirantes = esTodosAspirantes(contextoAsistencia)
        if (!seccionRegistro && !isTodosAspirantes) {
            setMensaje("⚠ Selecciona una sección", "error")
            return
        }

        setEstadoCargandoBotonRegistrar(true, "Procesando...");

        // 1. Obtener modo GPS del caché local o del cursoConfigCache
        const cachedGps = localStorage.getItem(`asistia_gps_config_${tenantActivoId}_${cursoActualId || 1}`);
        const gpsModoParsed = cachedGps ? JSON.parse(cachedGps) : null;
        const tieneConfigCargada = !!(cursoConfigCache || gpsModoParsed);
        const gpsModo = cursoConfigCache?.oper_gps_modo || gpsModoParsed?.oper_gps_modo || "desactivado";

        let gpsData = null;

        if (!tieneConfigCargada) {
            gpsData = {
                estado: "GPS_NO_DISPONIBLE",
                modo: "desactivado",
                mensaje: "No se pudo validar GPS porque no se pudo cargar la configuración del curso."
            };
            registrarDiagnosticoGps({ estado: "GPS_NO_DISPONIBLE" });
        } else if (gpsModo === "desactivado") {
            gpsData = {
                estado: "GPS_DESACTIVADO",
                modo: "desactivado",
                mensaje: "El control GPS está desactivado para este curso."
            };
            registrarDiagnosticoGps({ estado: "GPS_DESACTIVADO" });
        } else {
            gpsData = {
                estado: "GPS_NO_DISPONIBLE",
                modo: gpsModo,
                mensaje: "No se pudo obtener la ubicación o no hay programación diaria activa."
            };
            registrarDiagnosticoGps({ estado: "GPS_NO_DISPONIBLE" });
        }

        const isOnline = navigator.onLine && haySupabase();

        // Flujo Offline contingente
        if (!isOnline) {
            if (tieneConfigCargada && gpsModo !== "desactivado") {
                setEstadoCargandoBotonRegistrar(true, "Obteniendo ubicación...");
                try {
                    const coords = await obtenerUbicacionNavegador();
                    gpsData = {
                        latitud: coords.latitude,
                        longitud: coords.longitude,
                        accuracy: coords.accuracy,
                        estado: "GPS_DENTRO_RANGO",
                        modo: gpsModo,
                        mensaje: "offline_contingency"
                    };
                    registrarDiagnosticoGps({
                        estado: "GPS_DENTRO_RANGO",
                        precision: coords.accuracy,
                        duracionMs: coords.duracionMs
                    });
                } catch (err) {
                    console.warn("Fallo captura GPS offline:", err);
                    const detalleError = obtenerDetalleErrorGps(err);
                    gpsData = {
                        estado: detalleError.estado,
                        modo: gpsModo,
                        mensaje: "No se pudo obtener ubicación offline: " + (err.message || err)
                    };
                    registrarDiagnosticoGps({
                        estado: detalleError.estado,
                        codigo: detalleError.codigo,
                        duracionMs: err.duracionMs
                    });
                }
            }
            ultimoGpsData = gpsData;
            ultimoResultadoRegistro = { success: true, offline: true };
            await guardarAsistenciaOffline({
                dniRegistro,
                nombresValor,
                apellidosValor,
                seccionRegistro,
                modalidadRegistro: contextoAsistencia.modalidad,
                motivo: "No se pudo conectar con asistIA. Verifica tu conexión e inténtalo nuevamente.",
                gpsData
            });
            return;
        }

        // Flujo Online con validación real
        const fechaLoc = obtenerFechaHoraLima(new Date()).fecha;
        
        // Consultar programación diaria de geocercas
        const { data: prog, error: errorProg } = await supabaseClient.rpc("rpc_obtener_programacion_dia", {
            p_tenant_id: tenantActivoId,
            p_curso_id: cursoActualId || 1,
            p_dni: dniRegistro,
            p_fecha: fechaLoc
        });

        if (errorProg) {
            console.error("Error consultando rpc_obtener_programacion_dia:", errorProg);
        }

        // Si hay respuesta y hay_clase = false, bloquear
        if (prog && prog.success === true && prog.hay_clase === false) {
            setMensaje("Hoy no hay clase programada para registrar asistencia.", "error");
            return;
        }

        let warningMessage = "";
        let postRegisterAlert = "";

        let modoEvaluado = gpsModo;
        let configCargadaEvaluada = tieneConfigCargada;

        const tienePuntoProgramado = prog && prog.success === true && prog.hay_clase === true && 
            prog.punto_gps && prog.punto_gps.latitud != null && prog.punto_gps.longitud != null;

        if (tienePuntoProgramado && (!tieneConfigCargada || gpsModo === "desactivado")) {
            modoEvaluado = "solo_registrar";
            configCargadaEvaluada = true;
            gpsData = {
                estado: "GPS_NO_DISPONIBLE",
                modo: "solo_registrar",
                mensaje: "No se pudo obtener la ubicación o no hay programación diaria activa."
            };
            registrarDiagnosticoGps({ estado: "GPS_NO_DISPONIBLE" });
        }

        if (configCargadaEvaluada && modoEvaluado !== "desactivado") {
            if (prog && prog.success === true && prog.hay_clase === true) {
                const punto = prog.punto_gps;
                
                if (punto && punto.latitud != null && punto.longitud != null) {
                    setEstadoCargandoBotonRegistrar(true, "Obteniendo ubicación...");
                    try {
                        // Solicitar geolocalización
                        const coords = await obtenerUbicacionNavegador();
                        const distancia = calcularDistanciaGpsMetros(
                            coords.latitude,
                            coords.longitude,
                            Number(punto.latitud),
                            Number(punto.longitud)
                        );
                        const dentroRango = distancia <= Number(punto.radio_metros || 50);

                        gpsData = {
                            latitud: coords.latitude,
                            longitud: coords.longitude,
                            accuracy: coords.accuracy,
                            distancia_metros: Math.round(distancia * 100) / 100,
                            estado: dentroRango ? "GPS_DENTRO_RANGO" : "GPS_FUERA_RANGO",
                            punto_tipo: punto.tipo_punto,
                            punto_codigo: punto.codigo_punto,
                            punto_nombre: punto.nombre_punto,
                            modo: modoEvaluado
                        };

                        registrarDiagnosticoGps({
                            estado: gpsData.estado,
                            precision: coords.accuracy,
                            distanciaMetros: gpsData.distancia_metros,
                            radioPermitido: Number(punto.radio_metros || 50),
                            duracionMs: coords.duracionMs
                        });

                        if (!dentroRango) {
                            gpsData.mensaje = `Fuera de rango por ${Math.round(distancia - punto.radio_metros)} metros.`;
                            
                            if (modoEvaluado === "advertencia") {
                                warningMessage = "Tu asistencia fue registrada, pero tu ubicación está fuera del área autorizada. Este evento será informado automáticamente a la Jefatura de ESBAS.";
                                gpsData.mensaje = "[ADVERTENCIA] " + gpsData.mensaje;
                            } else if (modoEvaluado === "bloquear_fuera" || modoEvaluado === "bloquear_fuera_sin_gps") {
                                setMensaje("⚠ Te encuentras fuera del área autorizada para registrar la asistencia. Acércate a la sede correspondiente y vuelve a intentarlo.", "error");
                                return;
                            }
                        } else {
                            gpsData.mensaje = "Dentro de rango.";
                        }
                    } catch (geoError) {
                        console.warn("Error capturando ubicación del navegador:", geoError);
                        const detalleError = obtenerDetalleErrorGps(geoError);

                        gpsData = {
                            estado: detalleError.estado,
                            modo: modoEvaluado,
                            mensaje: detalleError.mensaje,
                            punto_tipo: punto.tipo_punto,
                            punto_codigo: punto.codigo_punto,
                            punto_nombre: punto.nombre_punto
                        };

                        registrarDiagnosticoGps({
                            estado: detalleError.estado,
                            codigo: detalleError.codigo,
                            duracionMs: geoError.duracionMs
                        });

                        if (modoEvaluado === "bloquear_fuera_sin_gps") {
                            setMensaje(detalleError.mensaje, "error");
                            return;
                        } else if (modoEvaluado === "solo_registrar" || modoEvaluado === "advertencia" || modoEvaluado === "bloquear_fuera") {
                            postRegisterAlert = "No fue posible obtener tu ubicación. La asistencia fue registrada. Este evento será informado automáticamente a la Jefatura de ESBAS para la validación correspondiente.";
                        }
                    }
                } else {
                    gpsData = {
                        estado: "GPS_NO_DISPONIBLE",
                        modo: modoEvaluado,
                        mensaje: "No hay punto GPS configurado para la clase de hoy en el calendario."
                    };
                    registrarDiagnosticoGps({ estado: "GPS_NO_DISPONIBLE" });
                }
            } else {
                gpsData = {
                    estado: "GPS_NO_DISPONIBLE",
                    modo: modoEvaluado,
                    mensaje: "No hay clase programada para registrar geocercas hoy."
                };
                registrarDiagnosticoGps({ estado: "GPS_NO_DISPONIBLE" });
            }
        }

        ultimoGpsData = gpsData;

        let data = null;
        let usoLegacy = false;

        try {
            data = await intentarRegistrarAsistenciaV2({
                dniRegistro,
                deviceId,
                gpsData
            });
        } catch (errorV2) {
            console.warn("Fallback legacy:", errorV2);
            usoLegacy = true;
        }

        if (usoLegacy) {
            data = await intentarRegistrarAsistenciaLegacy({
                dniRegistro,
                seccionRegistro,
                deviceId
            });
        }

        ultimoResultadoRegistro = data;

        if (!data?.success) {
            setMensaje(
                normalizarMensajePublicoFinal(String(data?.message || "Ocurrió un problema al procesar la solicitud.")),
                "error"
            );
            programarRetornoPostRegistro();
            return;
        }

        if (!data?.registrado && data?.code === "asistencia_duplicada") {
            const colaLoc = leerColaPendientes();
            const hoyLoc = obtenerFechaHoraLima(new Date()).fecha;
            const nuevaColaLoc = colaLoc.filter(item => {
                const esMismoDni = limpiarDni(item?.dni) === dniRegistro;
                const esHoy = String(item?.fecha_local || "").trim() === hoyLoc;
                return !(esMismoDni && esHoy);
            });
            guardarColaPendientes(nuevaColaLoc);
            actualizarContadorPendientes();

            setMensaje(
                normalizarMensajePublicoFinal(String(data?.message || "El aspirante ya registró asistencia hoy.")),
                "warning"
            );
            programarRetornoPostRegistro();
            return;
        }

        if (!data?.registrado && data?.code && data?.code !== "ok") {
            setMensaje(
                normalizarMensajePublicoFinal(String(data?.message || "No se pudo registrar la asistencia.")),
                "error"
            );
            programarRetornoPostRegistro();
            return;
        }

        const warnings = construirWarningsRegistro(data, contextoAsistencia);

        // Remover de la cola local si existe una asistencia pendiente hoy para este DNI
        const colaLoc = leerColaPendientes();
        const hoyLoc = obtenerFechaHoraLima(new Date()).fecha;
        const nuevaColaLoc = colaLoc.filter(item => {
            const esMismoDni = limpiarDni(item?.dni) === dniRegistro;
            const esHoy = String(item?.fecha_local || "").trim() === hoyLoc;
            return !(esMismoDni && esHoy);
        });
        guardarColaPendientes(nuevaColaLoc);
        actualizarContadorPendientes();

        const estadoHora = String(
            data?.contexto?.estado_asistencia
            || contextoAsistencia?.estado_asistencia
            || "PUNTUAL"
        ).trim().toUpperCase();

        let horarioTxt = "Puntual";
        if (estadoHora === "TARDANZA") {
            horarioTxt = "Tardanza";
        } else if (estadoHora === "FUERA_DE_HORARIO") {
            horarioTxt = "Fuera de horario";
        }

        let gpsTxt = "No disponible";
        let distanciaTxt = "";
        let gpsDentroRango = true;

        if (gpsData) {
            if (gpsData.estado === "GPS_DENTRO_RANGO") {
                gpsTxt = "Dentro de geocerca";
            } else if (gpsData.estado === "GPS_FUERA_RANGO") {
                gpsTxt = "Fuera de geocerca";
                gpsDentroRango = false;
            }
            if (gpsData.distancia_metros != null) {
                const distFormateada = formatearDistancia(gpsData.distancia_metros);
                if (distFormateada) {
                    distanciaTxt = `<br><br>Distancia<br>${distFormateada}`;
                }
            }
        }

        const msgFinal = `✅ Asistencia registrada<br><br>Horario<br>${horarioTxt}<br><br>Ubicación<br>${gpsTxt}${distanciaTxt}`;
        const esOk = (estadoHora === "PUNTUAL") && (gpsData ? (gpsData.estado !== "GPS_FUERA_RANGO" && gpsData.estado !== "GPS_NO_DISPONIBLE") : true);

        setMensaje(msgFinal, esOk ? "ok" : "warning");

        if (formulario) formulario.style.display = "none";
        if (stepIngreso) stepIngreso.style.display = "none";

        programarRetornoPostRegistro();
    } catch (e) {
        console.error("Error en guardarAsistencia:", e);
        ultimoResultadoRegistro = { success: false, error: e };
        const guardadoOffline = await guardarAsistenciaOffline({
            dniRegistro,
            nombresValor,
            apellidosValor,
            seccionRegistro,
            modalidadRegistro: contextoAsistencia.modalidad,
            motivo: !navigator.onLine || esErrorTransporteSupabase(e)
                ? "No se pudo conectar con asistIA. Verifica tu conexión e inténtalo nuevamente."
                : "Ocurrió un problema al procesar la solicitud.",
            gpsData: null
        });
        if (!guardadoOffline) {
            setMensaje(mensajeAmigable(e, "Ocurrió un problema al procesar la solicitud."), "error");
        }
    } finally {
        setEstadoCargandoBotonRegistrar(false);
    }
}

function bindEventos() {
    document.getElementById("btnIngresarInicio")?.addEventListener("click", ingresarMovilInicio)
    document.getElementById("btnRegistrar")?.addEventListener("click", guardarAsistencia)
    document.getElementById("btnVolver")?.addEventListener("click", volverInicio)
    document.getElementById("btnSoporteWa")?.addEventListener("click", abrirWhatsAppSoporte)

    mobileDniInicio?.addEventListener("input", () => procesarAutocompletadoDni(mobileDniInicio.value))

    mobileDniInicio?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") ingresarMovilInicio()
    })
}

async function init() {
    enlazarIds()
    bindEventos()
    actualizarContadorPendientes()

    tenantActivoId = detectarTenantDesdeRuta()
    aplicarTenantEnUI()

    if (!tenantActivoId) {
        setMensaje("⚠ No se pudo identificar la institución en la ruta.", "error")
        return
    }

    if (!haySupabase()) {
        setMensaje("No se pudo conectar con asistIA.", "error")
        return
    }

    const cursoValido = await resolverCursoDesdeURL()
    mostrarPasoMovil("ingreso")

    if (!cursoValido || !cursoQRValido) {
        setMensaje(ultimoEstadoCurso.message || "Acceso no válido. Escanee el código QR oficial del curso.", "error")
        if (mobileDniInicio) mobileDniInicio.disabled = true
        document.getElementById("btnIngresarInicio")?.setAttribute("disabled", "disabled")
        return
    }

    void sincronizarPendientes()
}

window.addEventListener("load", () => {
    void init()
})

window.addEventListener("online", () => {
    if (!leerColaPendientes().length) return
    void sincronizarPendientes({ notificar: true })
})

window.addEventListener("offline", () => {
    setMensaje("Sin conexión. Si registras asistencia, se guardará en este dispositivo.", "warning")
})

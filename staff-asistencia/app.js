const supabaseUrl = "https://kcapmyovaigjntaqeqwn.supabase.co"
const supabaseKey = "sb_publishable_oObf3s5mQ4sfmJ03JKQrnQ__8Rmb63F"

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null

let tenantActivoId = ""
let cursoActualId = null
let cursoContextoValido = true
let staffSeleccionado = null

let tenantLabel
let codigoBomberoInput
let staffCardSection
let mensaje

function haySupabase() {
    return !!supabaseClient
}

function enlazarIds() {
    tenantLabel = document.getElementById("tenantLabel")
    codigoBomberoInput = document.getElementById("codigoBomberoInput")
    staffCardSection = document.getElementById("staffCardSection")
    mensaje = document.getElementById("mensaje")
}

function setMensaje(texto, tipo = "") {
    if (!mensaje) return
    mensaje.className = "message-box"
    mensaje.innerText = texto || ""
    if (texto && tipo) mensaje.classList.add(tipo)
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
    const label = tenantActivoId ? `Institución: ${tenantActivoId}` : "Institución no detectada"
    if (tenantLabel) tenantLabel.textContent = label
    document.title = tenantActivoId ? `${tenantActivoId} - asistIA Staff` : "asistIA Staff"
}

function normalizarCodigoBombero(valor) {
    return String(valor || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20)
}

function normalizarTexto(valor) {
    return String(valor || "").trim()
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
    const badgeClass = tipo === "ADJUNTO" ? "adjunto" : "apoyo"

    staffCardSection.hidden = false
    staffCardSection.innerHTML = `
      <div class="staff-card-head">
        ${renderStaffAvatar(row)}
        <div class="staff-card-copy">
          <p class="staff-card-meta">${escapeHtml(normalizarTexto(row?.grado) || "Sin grado")}</p>
          <h2>${escapeHtml(nombre || "Staff")}</h2>
          <span class="staff-badge ${badgeClass}">${escapeHtml(tipo)}</span>
        </div>
      </div>

      <div class="staff-card-fields">
        <div class="staff-field"><strong>Código de Bombero</strong>${escapeHtml(normalizarTexto(row?.codigo_bombero) || "-")}</div>
        <div class="staff-field"><strong>UBO origen</strong>${escapeHtml(normalizarTexto(row?.ubo_origen) || "-")}</div>
        <div class="staff-field"><strong>Celular</strong>${escapeHtml(normalizarTexto(row?.celular) || "-")}</div>
        <div class="staff-field"><strong>Correo</strong>${escapeHtml(normalizarTexto(row?.correo) || "-")}</div>
      </div>

      <div class="staff-card-actions">
        <button id="btnRegistrarStaff" class="primary-btn" type="button">Registrar asistencia</button>
        <button id="btnResetStaff" class="secondary-btn" type="button">Buscar otro código</button>
      </div>
    `

    document.getElementById("btnRegistrarStaff")?.addEventListener("click", registrarAsistenciaStaff)
    document.getElementById("btnResetStaff")?.addEventListener("click", resetStaffSeleccionado)
}

function resetStaffSeleccionado() {
    staffSeleccionado = null
    if (staffCardSection) {
        staffCardSection.hidden = true
        staffCardSection.innerHTML = ""
    }
    if (codigoBomberoInput) {
        codigoBomberoInput.value = ""
        codigoBomberoInput.focus()
    }
    setMensaje("")
}

function obtenerCursoTokenDesdeURL() {
    try {
        const params = new URLSearchParams(window.location.search || "")
        return String(params.get("curso") || "").trim()
    } catch (e) {
        return ""
    }
}

async function resolverCursoDesdeURL() {
    const token = obtenerCursoTokenDesdeURL()
    cursoActualId = null
    cursoContextoValido = true

    if (!token || !haySupabase() || !tenantActivoId) return

    if (/^\d+$/.test(token)) {
        cursoActualId = Number(token)
        return
    }

    try {
        const { data, error } = await supabaseClient.rpc("rpc_validar_curso_qr", {
            p_qr_token: token,
            p_tenant_id: tenantActivoId
        })

        if (error || !data?.success) {
            cursoContextoValido = false
            cursoActualId = null
            return
        }

        cursoActualId = Number(data.curso_id || 0) || null
    } catch (e) {
        cursoContextoValido = false
        cursoActualId = null
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
        setMensaje("Ingresa tu Código de Bombero.", "error")
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

    const { data, error } = await supabaseClient
        .from("staff_instruccion")
        .select("*")
        .eq("tenant_id", tenantActivoId)
        .eq("codigo_bombero", codigo)
        .eq("activo", true)
        .maybeSingle()

    if (error) {
        setMensaje(
            /does not exist|42P01/i.test(String(error.message || ""))
                ? "El módulo staff aún no está habilitado en la base de datos."
                : `No se pudo validar el staff: ${error.message || "error desconocido"}`,
            "error"
        )
        return
    }

    if (!data) {
        staffSeleccionado = null
        if (staffCardSection) {
            staffCardSection.hidden = true
            staffCardSection.innerHTML = ""
        }
        setMensaje("No existe un staff activo con ese Código de Bombero.", "warning")
        return
    }

    staffSeleccionado = data
    renderStaffCard(data)
    setMensaje("Staff validado. Revisa la card y confirma tu ingreso.", "ok")
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

    const { data: existente, error: errorConsulta } = await supabaseClient
        .from("staff_asistencias")
        .select("id")
        .eq("tenant_id", tenantActivoId)
        .eq("staff_id", staffSeleccionado.id)
        .eq("fecha", lima.fecha)
        .maybeSingle()

    if (errorConsulta && !/0 rows/i.test(String(errorConsulta.message || ""))) {
        setMensaje(`No se pudo validar duplicados: ${errorConsulta.message || "error desconocido"}`, "error")
        return
    }

    if (existente?.id) {
        setMensaje("Ya registraste asistencia staff hoy.", "warning")
        return
    }

    const { error } = await supabaseClient
        .from("staff_asistencias")
        .insert([payload])

    if (error) {
        if (/duplicate key|23505/i.test(String(error.message || ""))) {
            setMensaje("Ya registraste asistencia staff hoy.", "warning")
            return
        }
        setMensaje(`No se pudo registrar la asistencia: ${error.message || "error desconocido"}`, "error")
        return
    }

    setMensaje(`Asistencia staff registrada a las ${lima.hora}.`, "ok")
}

function bindEventos() {
    document.getElementById("btnBuscarStaff")?.addEventListener("click", buscarStaffPorCodigo)
    codigoBomberoInput?.addEventListener("input", () => {
        if (codigoBomberoInput) codigoBomberoInput.value = normalizarCodigoBombero(codigoBomberoInput.value)
    })
    codigoBomberoInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") buscarStaffPorCodigo()
    })
}

async function init() {
    enlazarIds()
    bindEventos()

    tenantActivoId = detectarTenantDesdeRuta()
    aplicarTenantEnUI()

    if (!tenantActivoId) {
        setMensaje("No se pudo identificar la institución en la ruta.", "error")
        return
    }

    if (!haySupabase()) {
        setMensaje("No se pudo iniciar la conexión con el servidor.", "error")
        return
    }

    await resolverCursoDesdeURL()

    if (!cursoContextoValido) {
        setMensaje("El curso indicado no es válido para esta institución.", "error")
    }
}

window.addEventListener("load", () => {
    void init()
})

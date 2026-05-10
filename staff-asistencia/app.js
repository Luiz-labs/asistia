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

let tenantLabel
let codigoBomberoInput
let staffLookupSection
let staffCardSection
let staffSuccessSection
let mensaje

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
    const badgeClass = tipo === "ADJUNTO" ? "adjunto" : "apoyo"
    const celular = normalizarTexto(row?.celular)
    const correo = normalizarTexto(row?.correo)
    const foto = normalizarTexto(row?.foto_url)

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

      <div class="staff-profile-tools">
        <button id="btnEditarPerfilStaff" class="tertiary-btn" type="button">${staffPerfilEditando ? "Ocultar edición" : "Editar perfil"}</button>
      </div>

      <form id="staffProfileForm" class="staff-profile-form${staffPerfilEditando ? " is-open" : ""}">
        <div class="staff-profile-form-head">
          <div>
            <h3>Editar perfil</h3>
            <p>Solo puedes actualizar foto, celular y correo.</p>
          </div>
        </div>

        <div class="staff-photo-editor">
          <div class="staff-photo-preview">
            ${foto ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre || "Foto staff")}" class="staff-photo-preview-img">` : `<div class="staff-photo-preview-empty">${escapeHtml(obtenerInicialesStaff(row))}</div>`}
          </div>
          <div class="staff-photo-copy">
            <strong>Foto de perfil</strong>
            <span>JPG, PNG o WEBP. Máximo 2 MB.</span>
            <input id="staffFotoFile" type="file" accept="image/jpeg,image/png,image/webp">
          </div>
        </div>

        <div class="staff-profile-grid">
          <label class="staff-profile-field">
            <span>Celular</span>
            <input id="staffPerfilCelular" class="text-input" value="${escapeHtml(celular)}" placeholder="Solo números" inputmode="numeric" autocomplete="tel">
          </label>
          <label class="staff-profile-field">
            <span>Correo</span>
            <input id="staffPerfilCorreo" class="text-input" value="${escapeHtml(correo)}" placeholder="correo@dominio.com" type="email" autocomplete="email">
          </label>
        </div>

        <p id="staffProfileMsg" class="inline-form-msg" aria-live="polite"></p>

        <div class="staff-profile-actions">
          <button id="btnGuardarPerfilStaff" class="primary-btn" type="submit" ${staffPerfilGuardando ? "disabled" : ""}>${staffPerfilGuardando ? "Guardando..." : "Guardar cambios"}</button>
          <button id="btnCancelarPerfilStaff" class="secondary-btn" type="button" ${staffPerfilGuardando ? "disabled" : ""}>Cancelar</button>
        </div>
      </form>

      <div class="staff-card-actions">
        <button id="btnRegistrarStaff" class="primary-btn" type="button">Registrar asistencia</button>
        <button id="btnResetStaff" class="secondary-btn" type="button">Registrar otro staff</button>
      </div>
    `

    document.getElementById("btnRegistrarStaff")?.addEventListener("click", registrarAsistenciaStaff)
    document.getElementById("btnResetStaff")?.addEventListener("click", resetStaffSeleccionado)
    document.getElementById("btnEditarPerfilStaff")?.addEventListener("click", toggleEdicionPerfilStaff)
    document.getElementById("btnCancelarPerfilStaff")?.addEventListener("click", cancelarEdicionPerfilStaff)
    document.getElementById("staffProfileForm")?.addEventListener("submit", guardarPerfilStaff)
    document.getElementById("staffPerfilCelular")?.addEventListener("input", () => {
        const input = document.getElementById("staffPerfilCelular")
        if (input) input.value = normalizarCelular(input.value)
    })
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
    staffPerfilEditando = false
    staffPerfilGuardando = false
    setPerfilMsg("")
    renderStaffCard(staffSeleccionado)
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
        throw new Error(
            /bucket/i.test(String(uploadError.message || ""))
                ? "No se pudo subir la foto. Verifica que el bucket staff-fotos exista y permita uploads."
                : `No se pudo subir la foto: ${uploadError.message || "error desconocido"}`
        )
    }

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path)
    const publicUrl = normalizarTexto(data?.publicUrl)
    if (!publicUrl) {
        throw new Error("La foto se subió, pero no se pudo obtener la URL pública.")
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
    renderStaffCard(staffSeleccionado)
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
            throw new Error(
                /policy|rls|permission|row-level/i.test(String(error.message || ""))
                    ? "No se pudo actualizar el perfil por políticas de seguridad. Revisa el SQL sugerido de Storage/RLS."
                    : `No se pudo actualizar el perfil: ${error.message || "error desconocido"}`
            )
        }
        if (!data?.id) {
            throw new Error("No se pudo confirmar la actualización del perfil. Revisa las políticas RLS para staff_instruccion.")
        }

        staffSeleccionado = {
            ...staffSeleccionado,
            ...data
        }
        staffPerfilEditando = false
        staffPerfilGuardando = false
        renderStaffCard(staffSeleccionado)
        setMensaje("Perfil actualizado correctamente.", "ok")
    } catch (error) {
        staffPerfilGuardando = false
        renderStaffCard(staffSeleccionado)
        setPerfilMsg(error.message || "No se pudo actualizar el perfil.", "error")
    }
}

function actualizarEstadoVistaStaff(estado = "inicio", detalle = {}) {
    const esInicio = estado === "inicio"
    const esValidado = estado === "validado"
    const esRegistrado = estado === "registrado"

    if (staffLookupSection) {
        staffLookupSection.hidden = esValidado || esRegistrado
        staffLookupSection.classList.toggle("is-collapsed", esValidado || esRegistrado)
    }
    if (staffCardSection) {
        staffCardSection.hidden = !(esValidado || esRegistrado)
        staffCardSection.classList.toggle("is-compact", esValidado || esRegistrado)
        staffCardSection.classList.toggle("is-success", esRegistrado)
    }
    if (staffSuccessSection) {
        staffSuccessSection.hidden = !esRegistrado
        if (esRegistrado) {
            staffSuccessSection.innerHTML = `
              <div class="success-badge">Registro exitoso</div>
              <h3>Asistencia staff registrada correctamente</h3>
              <p>Hora de marcación: <strong>${escapeHtml(detalle.hora || "--:--:--")}</strong></p>
              <button id="btnSuccessResetStaff" class="secondary-btn" type="button">Registrar otro staff</button>
            `
            document.getElementById("btnSuccessResetStaff")?.addEventListener("click", resetStaffSeleccionado)
        } else {
            staffSuccessSection.innerHTML = ""
        }
    }
}

function resetStaffSeleccionado() {
    staffSeleccionado = null
    staffPerfilEditando = false
    staffPerfilGuardando = false
    if (staffCardSection) {
        staffCardSection.hidden = true
        staffCardSection.innerHTML = ""
    }
    if (staffSuccessSection) {
        staffSuccessSection.hidden = true
        staffSuccessSection.innerHTML = ""
    }
    if (staffLookupSection) {
        staffLookupSection.hidden = false
        staffLookupSection.classList.remove("is-collapsed")
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
        staffPerfilEditando = false
        staffPerfilGuardando = false
        if (staffCardSection) {
            staffCardSection.hidden = true
            staffCardSection.innerHTML = ""
        }
        setMensaje("No existe un staff activo con ese Código de Bombero.", "warning")
        return
    }

    staffSeleccionado = data
    staffPerfilEditando = false
    staffPerfilGuardando = false
    renderStaffCard(data)
    actualizarEstadoVistaStaff("validado")
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

    actualizarEstadoVistaStaff("registrado", { hora: lima.hora })
    setMensaje(`Asistencia staff registrada correctamente a las ${lima.hora}.`, "ok")
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
    actualizarEstadoVistaStaff("inicio")
}

window.addEventListener("load", () => {
    void init()
})

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
        setSectionVisible(staffCardSection, false)
        setSectionVisible(staffSuccessSection, false)
        setSectionVisible(staffProfileModal, false)
        if (staffProfileModal) staffProfileModal.setAttribute("aria-hidden", "true")
        document.body.classList.remove("staff-modal-open")
        if (!detalle.preserveMessage) setMensaje("")
        if (staffSuccessSection) staffSuccessSection.innerHTML = ""
        return
    }

    if (view === "perfil") {
        setSectionVisible(staffLookupSection, false)
        setSectionVisible(staffCardSection, true)
        setSectionVisible(staffSuccessSection, false)
        setSectionVisible(staffProfileModal, false)
        if (staffProfileModal) staffProfileModal.setAttribute("aria-hidden", "true")
        document.body.classList.remove("staff-modal-open")
        if (staffSuccessSection) staffSuccessSection.innerHTML = ""
        return
    }

    if (view === "editar") {
        setSectionVisible(staffLookupSection, false)
        setSectionVisible(staffCardSection, false)
        setSectionVisible(staffSuccessSection, false)
        setSectionVisible(staffProfileModal, true, "flex")
        return
    }

    if (view === "exito") {
        setSectionVisible(staffLookupSection, false)
        setSectionVisible(staffCardSection, false)
        setSectionVisible(staffSuccessSection, true)
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
        staffSuccessResetTimer = setTimeout(() => {
            resetStaffSeleccionado()
        }, 3000)
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
}

function setMensaje(texto, tipo = "") {
    if (!mensaje) return
    mensaje.className = "message-box"
    mensaje.innerText = texto || ""
    if (texto && tipo) mensaje.classList.add(tipo)
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
    const badgeClass = tipo === "ADJUNTO" ? "adjunto" : "apoyo"

    setSectionVisible(staffCardSection, true)
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
        staffPerfilGuardando = false
        renderStaffCard(staffSeleccionado)
        renderPreviewFotoModalStaff(staffSeleccionado)
        cerrarModalPerfilStaff()
        setMensaje("Perfil actualizado correctamente.", "ok")
    } catch (error) {
        staffPerfilGuardando = false
        actualizarEstadoModalPerfilStaff()
        setPerfilMsg(error.message || "No se pudo actualizar el perfil.", "error")
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

async function resolverCursoDesdeURL() {
    const token = obtenerCursoTokenDesdeURL()
    cursoActualId = null
    cursoContextoValido = false

    if (!token || !haySupabase() || !tenantActivoId) return false

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
        return !!cursoActualId
    } catch (e) {
        cursoContextoValido = false
        cursoActualId = null
        return false
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
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !staffProfileModal?.hidden) cancelarEdicionPerfilStaff()
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
    actualizarDisponibilidadIngresoStaff()

    if (!cursoContextoValido) {
        setMensaje("El curso indicado no es válido para esta institución.", "error")
    }
    setStaffView("login", { preserveMessage: !cursoContextoValido })
}

window.addEventListener("load", () => {
    void init()
})

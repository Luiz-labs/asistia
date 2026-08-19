import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"
import webpush from "npm:web-push"

// Cargar secretos de entorno
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? ""
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@asistia.com"

// Configurar web-push
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const jsonHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }

// ---------------------------------------------------------------------
// Formato de fecha/hora para los mensajes -- huso fijo America/Lima
// (-05:00), mismo criterio que ya usa fn_iniciar_push_jornada (sql/025)
// para no depender de la zona horaria del servidor.
// ---------------------------------------------------------------------

const fechaCortaFormatter = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  weekday: "short",
  day: "numeric",
  month: "short",
})

// "Dom 17 ago"
function formatFechaCorta(date: Date): string {
  const texto = fechaCortaFormatter.format(date).replace(/\./g, "")
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// "8:15am"
function formatHoraCorta(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date)
  const hour = parts.find(p => p.type === "hour")?.value || ""
  const minute = parts.find(p => p.type === "minute")?.value || ""
  const dayPeriod = (parts.find(p => p.type === "dayPeriod")?.value || "").toLowerCase().replace(/\./g, "")
  return `${hour}:${minute}${dayPeriod}`
}

// Construye un timestamp real a partir de una fecha (YYYY-MM-DD) y una
// hora (HH:MM:SS), asumiendo siempre huso America/Lima (-05:00 fijo).
function limaTimestamp(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora}-05:00`)
}

serve(async (req) => {
  // Manejo de preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 0. Body: {tenant_id, curso_id, fecha_jornada} -- lo envía el cron
    // temporal que programa fn_iniciar_push_jornada (sql/025) para esta
    // jornada específica. Ya no hay barrido de todas las reglas activas.
    const body = await req.json().catch(() => ({}))
    const tenant_id = body?.tenant_id
    const curso_id = body?.curso_id
    const fecha_jornada = body?.fecha_jornada

    if (!tenant_id || curso_id === undefined || curso_id === null || !fecha_jornada) {
      return new Response(
        JSON.stringify({ error: "Faltan tenant_id/curso_id/fecha_jornada en el body." }),
        { status: 400, headers: jsonHeaders }
      )
    }

    // 1. Cargar el tracker de esta jornada. Lo crea fn_iniciar_push_jornada
    // (sql/025) al primer registro de staff_asistencias del día -- esa
    // tabla solo dispara el reloj, no participa en ningún conteo de esta
    // función. Esta función únicamente lee y actualiza el tracker.
    const { data: tracker, error: trackErr } = await supabase
      .from("staff_push_tracker")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("curso_id", curso_id)
      .eq("fecha_jornada", fecha_jornada)
      .maybeSingle()

    if (trackErr) throw trackErr

    if (!tracker) {
      return new Response(JSON.stringify({ status: "skip_sin_tracker" }), { headers: jsonHeaders })
    }

    if (tracker.finalizado) {
      // Red de seguridad: si el self-unschedule del ciclo que marcó
      // finalizado=true falló, este ciclo huérfano se autodesprograma aquí
      // en vez de seguir corriendo cada 5 min indefinidamente.
      if (tracker.cron_job_name) {
        try {
          await supabase.rpc("rpc_unschedule_push_cron", { p_job_name: tracker.cron_job_name })
        } catch (error: any) {
          console.warn("[push-avisos] Error al desprogramar cron de tracker finalizado:", error.message)
        }
      }
      return new Response(JSON.stringify({ status: "skip_finalizado" }), { headers: jsonHeaders })
    }

    // 2. Institución del tenant: nombre para el encabezado + feature flag.
    // Acotado a un solo tenant (ya no hay institucionesMap global).
    const { data: institucion, error: instErr } = await supabase
      .from("instituciones_luiz")
      .select("nombre, push_habilitado")
      .eq("slug", tenant_id)
      .maybeSingle()

    if (instErr) throw instErr

    if (!institucion?.push_habilitado) {
      return new Response(JSON.stringify({ status: "skip_push_deshabilitado" }), { headers: jsonHeaders })
    }

    const nombreInstitucion = institucion.nombre || tenant_id
    const jornadaInicioAt = new Date(tracker.jornada_inicio_at)
    const now = new Date()

    // 3. Qué cortes/avisos vencen en este tick. No son excluyentes entre
    // sí: si el cron perdió ticks, pueden vencer varios a la vez.
    const necesitaCorte1 = now >= new Date(tracker.corte1_en) && tracker.corte1_presentes === null
    const necesitaAviso1 = now >= new Date(tracker.aviso1_en) && !tracker.aviso1_enviado_at
    const necesitaCorte2 = now >= new Date(tracker.corte2_en) && tracker.corte2_presentes === null
    const necesitaAviso2 = now >= new Date(tracker.aviso2_en) && !tracker.aviso2_enviado_at
    const necesitaCorte3 = now >= new Date(tracker.corte3_en) && tracker.corte3_presentes === null
    const necesitaAviso3 = now >= new Date(tracker.aviso3_en) && !tracker.aviso3_enviado_at

    const necesitaEstadisticas =
      necesitaCorte1 || necesitaAviso1 || necesitaCorte2 || necesitaAviso2 || necesitaCorte3 || necesitaAviso3

    if (!necesitaEstadisticas) {
      return new Response(JSON.stringify({ status: "sin_eventos_pendientes" }), { headers: jsonHeaders })
    }

    // 4. Estadísticas en tiempo real de ASPIRANTES (población que se
    // cuenta y se reporta -- staff_asistencias solo disparó el trigger,
    // no participa aquí). Se calculan una sola vez por invocación y se
    // reutilizan para todos los cortes/avisos que venzan en este tick.
    //
    // A. Total esperados: matriculados en el curso. Se sigue calculando
    // aunque el Aviso 3 ya no lo muestre (queda oculto, no se borra).
    const { count: esperados, error: countErr } = await supabase
      .from("aspirantes")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant_id)
      .eq("curso_id", curso_id)

    if (countErr) throw countErr

    // B. Presentes hoy + hora de marca, para poder clasificar puntual/
    // tardanza.
    const { data: asistenciasHoy, error: asistErr } = await supabase
      .from("asistencias")
      .select("dni, hora")
      .eq("tenant_id", tenant_id)
      .eq("curso_id", curso_id)
      .eq("fecha", fecha_jornada)

    if (asistErr) throw asistErr

    // Dedupe por dni, quedándonos con la marca más temprana si hay más de
    // un registro el mismo día.
    const marcaPorDni = new Map<string, string>()
    for (const a of (asistenciasHoy || [])) {
      if (!a.dni || !a.hora) continue
      const actual = marcaPorDni.get(a.dni)
      if (!actual || a.hora < actual) marcaPorDni.set(a.dni, a.hora)
    }

    // Regla de tardanza FIJA acordada: hora de marca posterior a
    // jornada_inicio_at = Tardanza, sin excepciones. No se lee
    // estado_asistencia ni tolerancia_tardanza_min -- esa es la lógica de
    // tolerancia operativa de fn_resolver_contexto_asistencia (sql/012),
    // que es un concepto distinto e independiente de este desglose.
    let puntual = 0
    let tardanza = 0
    for (const hora of marcaPorDni.values()) {
      const marcaAt = limaTimestamp(fecha_jornada, hora)
      if (marcaAt.getTime() > jornadaInicioAt.getTime()) {
        tardanza++
      } else {
        puntual++
      }
    }
    const presentes = marcaPorDni.size
    const porcentaje = esperados && esperados > 0 ? Math.round((presentes / esperados) * 100) : 0

    // 5. Evaluar cada corte/aviso de forma independiente y armar los
    // textos que correspondan. Puede haber 0, 1, 2 o 3 avisos en el mismo
    // tick.
    const updatesTracker: Record<string, unknown> = {}
    const avisosAEnviar: { staff: string; backoffice: string }[] = []

    // --- Corte 1 / Aviso 1 ---
    let corte1Presentes = tracker.corte1_presentes
    let corte1Puntual = tracker.corte1_puntual

    if (necesitaCorte1) {
      corte1Presentes = presentes
      corte1Puntual = puntual
      updatesTracker.corte1_presentes = presentes
      updatesTracker.corte1_puntual = puntual
    }

    if (necesitaAviso1) {
      // Fallback: si por un tick perdido corte1 nunca se capturó, se
      // calcula aquí mismo -- nunca se omite el aviso por falta de dato.
      if (corte1Presentes === null || corte1Presentes === undefined) {
        corte1Presentes = presentes
        corte1Puntual = puntual
        updatesTracker.corte1_presentes = presentes
        updatesTracker.corte1_puntual = puntual
      }
      const corte1Tardanza = corte1Presentes - (corte1Puntual ?? 0)
      const lineaCorte1 = `Puntual: ${corte1Puntual ?? 0} | Tardanza: ${corte1Tardanza}`
      const lineaFechaCorte1 = `${formatFechaCorta(jornadaInicioAt)}, corte ${formatHoraCorta(new Date(tracker.corte1_en))}`

      avisosAEnviar.push({
        staff: `${lineaFechaCorte1}\n${lineaCorte1}`,
        backoffice: `asistIA -- ${nombreInstitucion}\n${lineaFechaCorte1}\n${lineaCorte1}`
      })
      updatesTracker.aviso1_enviado_at = now.toISOString()
    }

    // --- Corte 2 / Aviso 2 (acumulativo: repite la línea de corte1 ya
    // enviada, sin recalcularla, más la línea nueva de corte2) ---
    let corte2Presentes = tracker.corte2_presentes
    let corte2Puntual = tracker.corte2_puntual

    if (necesitaCorte2) {
      corte2Presentes = presentes
      corte2Puntual = puntual
      updatesTracker.corte2_presentes = presentes
      updatesTracker.corte2_puntual = puntual
    }

    if (necesitaAviso2) {
      if (corte2Presentes === null || corte2Presentes === undefined) {
        corte2Presentes = presentes
        corte2Puntual = puntual
        updatesTracker.corte2_presentes = presentes
        updatesTracker.corte2_puntual = puntual
      }
      // corte1 debería existir siempre a esta altura (aviso2_en > aviso1_en
      // > corte1_en), pero por consistencia con el resto de fallbacks no se
      // asume: si faltara, se calcula con los datos actuales igual que
      // arriba, en vez de omitir la línea.
      if (corte1Presentes === null || corte1Presentes === undefined) {
        corte1Presentes = presentes
        corte1Puntual = puntual
        updatesTracker.corte1_presentes = presentes
        updatesTracker.corte1_puntual = puntual
      }

      const corte1Tardanza = corte1Presentes - (corte1Puntual ?? 0)
      const corte2Tardanza = corte2Presentes - (corte2Puntual ?? 0)
      const lineasCortes =
        `Corte ${formatHoraCorta(new Date(tracker.corte1_en))} -- Puntual: ${corte1Puntual ?? 0} | Tardanza: ${corte1Tardanza}\n` +
        `Corte ${formatHoraCorta(new Date(tracker.corte2_en))} -- Puntual: ${corte2Puntual ?? 0} | Tardanza: ${corte2Tardanza}`

      avisosAEnviar.push({
        staff: lineasCortes,
        backoffice: `asistIA -- ${nombreInstitucion}\n${lineasCortes}`
      })
      updatesTracker.aviso2_enviado_at = now.toISOString()
    }

    // --- Corte 3 / Aviso 3 (FINAL: total simple, sin desglose por corte,
    // sin "de esperados" ni porcentaje -- ese cálculo queda hecho arriba
    // pero oculto, no se borra) ---
    let corte3Presentes = tracker.corte3_presentes
    let corte3Puntual = tracker.corte3_puntual

    if (necesitaCorte3) {
      corte3Presentes = presentes
      corte3Puntual = puntual
      updatesTracker.corte3_presentes = presentes
      updatesTracker.corte3_puntual = puntual
    }

    if (necesitaAviso3) {
      if (corte3Presentes === null || corte3Presentes === undefined) {
        corte3Presentes = presentes
        corte3Puntual = puntual
        updatesTracker.corte3_presentes = presentes
        updatesTracker.corte3_puntual = puntual
      }

      avisosAEnviar.push({
        staff: `Total registrados: ${corte3Presentes}`,
        backoffice: `asistIA -- ${nombreInstitucion}\nTotal registrados: ${corte3Presentes}`
      })
      updatesTracker.aviso3_enviado_at = now.toISOString()
      updatesTracker.finalizado = true
    }

    // 6. Despachar cada aviso pendiente (0 a 3 en este tick) al staff del
    // curso y al backoffice. Se cargan las listas de destinatarios una
    // sola vez y se reutilizan para todos los avisos del tick.
    if (avisosAEnviar.length > 0) {
      // A. Staff de instrucción del curso
      const { data: staffList, error: staffErr } = await supabase
        .from("staff_instruccion")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("curso_id", curso_id)
        .eq("activo", true)

      if (staffErr) throw staffErr

      let subs: any[] = []
      if (staffList && staffList.length > 0) {
        const staffIds = staffList.map(s => s.id)
        const { data: staffSubs, error: subErr } = await supabase
          .from("staff_push_subscriptions")
          .select("*")
          .eq("tenant_id", tenant_id)
          .in("staff_id", staffIds)
          .eq("estado", "activo")

        if (subErr) throw subErr
        subs = staffSubs || []
      }

      // B. Suscripciones push de backoffice (Superusuario/Administrador)
      let backofficeSubs: any[] = []
      try {
        const { data: boSubs, error: boSubsErr } = await supabase
          .from("backoffice_push_subscriptions")
          .select("*, ua:usuario_admin_id(rol, tenant_id, activo)")
          .eq("estado", "activo")

        if (boSubsErr) throw boSubsErr
        backofficeSubs = boSubs || []
      } catch (error: any) {
        console.warn("[push-avisos] Error al cargar suscripciones de backoffice:", error.message)
      }

      const destinatariosBackoffice = backofficeSubs.filter(sub => {
        const ua = sub.ua
        if (!ua || ua.activo !== true) return false
        if (ua.rol === "super_admin") return true
        return ua.rol === "administrador" && ua.tenant_id === tenant_id
      })

      for (const { staff: bodyStaff, backoffice: bodyBackoffice } of avisosAEnviar) {
        // Staff de instrucción
        if (subs.length > 0) {
          const payload = JSON.stringify({
            title: "asistIA Staff",
            body: bodyStaff,
            url: `/staff-asistencia/?tenant=${encodeURIComponent(tenant_id)}`
          })

          for (const sub of subs) {
            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            }

            try {
              await webpush.sendNotification(pushSubscription, payload)
            } catch (error: any) {
              console.warn(`[push-avisos] Error al notificar suscripción ${sub.id}:`, error.message)
              if (error.statusCode === 404 || error.statusCode === 410) {
                await supabase
                  .from("staff_push_subscriptions")
                  .update({ estado: "inactivo", updated_at: new Date().toISOString() })
                  .eq("id", sub.id)
              }
            }
          }
        }

        // Backoffice -- texto propio (con línea de institución, a
        // diferencia de Staff): el Superusuario ve varias instituciones a
        // la vez, así que ahí sí hace falta identificarla en cada aviso.
        try {
          if (destinatariosBackoffice.length > 0) {
            const payloadBackoffice = JSON.stringify({
              title: "asistIA Backoffice",
              body: bodyBackoffice,
              url: `/index.html?tenant=${encodeURIComponent(tenant_id)}`
            })

            for (const sub of destinatariosBackoffice) {
              const pushSubscription = {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
              }

              try {
                await webpush.sendNotification(pushSubscription, payloadBackoffice)
              } catch (error: any) {
                console.warn(`[push-avisos] Error al notificar suscripción backoffice ${sub.id}:`, error.message)
                if (error.statusCode === 404 || error.statusCode === 410) {
                  await supabase
                    .from("backoffice_push_subscriptions")
                    .update({ estado: "inactivo", updated_at: new Date().toISOString() })
                    .eq("id", sub.id)
                }
              }
            }
          }
        } catch (error: any) {
          console.warn(`[push-avisos] Error en despacho de backoffice para ${tenant_id}:`, error.message)
        }
      }
    }

    // 7. Persistir cambios del tracker (capturas de corte + avisos
    // enviados + finalizado, todo en un solo UPDATE).
    if (Object.keys(updatesTracker).length > 0) {
      const { error: updErr } = await supabase
        .from("staff_push_tracker")
        .update({ ...updatesTracker, updated_at: new Date().toISOString() })
        .eq("id", tracker.id)

      if (updErr) throw updErr
    }

    // 8. Si el Aviso 3 finalizó la jornada, autodesprogramar el cron
    // temporal de esta jornada (la Edge Function conoce su propio
    // cron_job_name a través del tracker).
    if (updatesTracker.finalizado && tracker.cron_job_name) {
      try {
        await supabase.rpc("rpc_unschedule_push_cron", { p_job_name: tracker.cron_job_name })
      } catch (error: any) {
        console.warn("[push-avisos] Error al autodesprogramar cron:", error.message)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tenant_id,
      curso_id,
      fecha_jornada,
      avisos_enviados: avisosAEnviar.length,
      presentes,
      esperados,
      porcentaje,
      finalizado: Boolean(updatesTracker.finalizado)
    }), { headers: jsonHeaders })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: jsonHeaders
    })
  }
})

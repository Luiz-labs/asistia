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

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function getLimaDateTime(date = new Date()) {
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");
  const second = getPart("second");
  
  // YYYY-MM-DD
  const fecha = `${year}-${month}-${day}`;
  const hora = `${hour}:${minute}:${second}`;
  
  return { fecha, hora };
}

const ANTICIPACION_MAX_MINS = 120

serve(async (req) => {
  // Manejo de preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Obtener la hora actual de Lima
    const { fecha, hora } = getLimaDateTime();
    const now = new Date();

    // 2. Obtener las reglas de jornada activas para hoy
    const { data: rules, error: ruleErr } = await supabase
      .from("curso_jornada_reglas")
      .select("*, j:jornada_id(codigo, nombre_visible)")
      .eq("activa", true);

    if (ruleErr) throw ruleErr;
    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ message: "No se encontraron reglas de jornada activas hoy." }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Mapa de instituciones (nombre + flag de push) -- una sola query para
    // todos los tenants presentes en las reglas, en vez de una por regla.
    const tenantIds = Array.from(new Set(rules.map(r => r.tenant_id)));
    const institucionesMap = new Map();
    if (tenantIds.length > 0) {
      const { data: instituciones, error: instErr } = await supabase
        .from("instituciones_luiz")
        .select("slug, nombre, push_habilitado")
        .in("slug", tenantIds);

      if (instErr) throw instErr;

      for (const inst of (instituciones || [])) {
        institucionesMap.set(inst.slug, inst);
      }
    }

    // Suscripciones push de backoffice -- una sola query para todo el
    // ciclo del cron (no una por regla), igual que institucionesMap. Un
    // fallo aquí no debe abortar el aviso a staff_instruccion de ningún
    // tenant, así que se aísla con su propio try/catch y degrada a lista
    // vacía (el canal de backoffice simplemente no notifica ese ciclo).
    let backofficeSubs = [];
    try {
      const { data: boSubs, error: boSubsErr } = await supabase
        .from("backoffice_push_subscriptions")
        .select("*, ua:usuario_admin_id(rol, tenant_id, activo)")
        .eq("estado", "activo");

      if (boSubsErr) throw boSubsErr;
      backofficeSubs = boSubs || [];
    } catch (error: any) {
      console.warn("[cron-push] Error al cargar suscripciones de backoffice:", error.message);
    }

    const resultados = [];

    for (const rule of rules) {
      // C. Feature flag por institución: saltar por completo (sin tracker
      // ni queries pesadas) si no está habilitado. Si la institución no
      // aparece en el mapa (fila borrada, error de join, etc.) el optional
      // chaining resuelve a undefined y !undefined es true -> se salta.
      // Ante la duda, NO se notifica.
      if (!institucionesMap.get(rule.tenant_id)?.push_habilitado) {
        resultados.push({
          jornada: rule.j?.codigo || "SECCION_REGULAR",
          status: "skip_push_deshabilitado"
        });
        continue;
      }

      const jornadaCodigo = rule.j?.codigo || "SECCION_REGULAR";
      const horaInicioStr = rule.hora_inicio; // Formato HH:MM:SS
      
      // Crear el objeto Date de inicio de jornada en huso GMT-5 (Lima)
      const jornadaInicioAt = new Date(`${fecha}T${horaInicioStr}-05:00`);
      const diffMinutes = (now.getTime() - jornadaInicioAt.getTime()) / (1000 * 60);

      // A. Filtro barato de anticipación: si aún faltan más de
      // ANTICIPACION_MAX_MINS para el inicio de la jornada, no vale la pena
      // evaluar esta regla en este ciclo -- evita tocar el tracker y las
      // queries pesadas (count de aspirantes, fetch de asistencias) de
      // madrugada, muy fuera de ventana.
      if (diffMinutes < -ANTICIPACION_MAX_MINS) {
        resultados.push({ jornada: jornadaCodigo, status: "skip_anticipado" });
        continue;
      }

      // Aislamiento completo de la prueba acelerada
      const isTest = rule.tenant_id === "esbas-24" && 
                     rule.curso_id === 1 && 
                     jornadaCodigo === "PRUEBA_ACELERADA" &&
                     fecha === getLimaDateTime().fecha;

      // Definición de umbrales
      const PRIMER_AVISO_MINS = isTest ? 2 : 60;
      const AGRUPACION_MINS = isTest ? 1 : 10;
      const FIN_MINS = isTest ? 10 : 240;

      // 3. Buscar o inicializar el tracker
      let { data: tracker, error: trackErr } = await supabase
        .from("staff_push_tracker")
        .select("*")
        .eq("tenant_id", rule.tenant_id)
        .eq("curso_id", rule.curso_id)
        .eq("fecha_jornada", fecha)
        .maybeSingle();

      if (trackErr) throw trackErr;

      if (!tracker) {
        const { data: newTracker, error: insErr } = await supabase
          .from("staff_push_tracker")
          .insert({
            tenant_id: rule.tenant_id,
            curso_id: rule.curso_id,
            fecha_jornada: fecha,
            jornada_inicio_at: jornadaInicioAt.toISOString(),
            primer_aviso_enviado: false,
            ultimo_total_presentes: 0,
            finalizado: false
          })
          .select("*")
          .single();

        if (insErr) throw insErr;
        tracker = newTracker;
      }

      // Si la jornada ya finalizó para los avisos, saltar
      if (tracker.finalizado) {
        resultados.push({ jornada: jornadaCodigo, status: "skip_finalizado" });
        continue;
      }

      // 4. Evaluar fin de jornada de avisos (T + FIN_MINS)
      if (diffMinutes >= FIN_MINS) {
        await supabase
          .from("staff_push_tracker")
          .update({ finalizado: true, updated_at: new Date().toISOString() })
          .eq("id", tracker.id);

        resultados.push({ jornada: jornadaCodigo, status: "finalizado_ahora" });
        continue;
      }

      // 5. Calcular estadísticas en tiempo real
      // A. Total esperados
      const { count: esperados, error: countErr } = await supabase
        .from("aspirantes")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", rule.tenant_id)
        .eq("curso_id", rule.curso_id);

      if (countErr) throw countErr;

      // B. Presentes hoy
      const { data: asistencias, error: asistErr } = await supabase
        .from("asistencias")
        .select("dni")
        .eq("tenant_id", rule.tenant_id)
        .eq("curso_id", rule.curso_id)
        .eq("fecha", fecha);

      if (asistErr) throw asistErr;

      const presentes = new Set((asistencias || []).map(a => a.dni)).size;
      const pendientes = (esperados || 0) - presentes;
      const porcentaje = esperados && esperados > 0 ? Math.round((presentes / esperados) * 100) : 0;

      let enviarNotificacion = false;
      let bodyText = "";
      let updatesTracker: any = {};

      // 6. Evaluar Primer Aviso (T >= PRIMER_AVISO_MINS)
      if (diffMinutes >= PRIMER_AVISO_MINS && !tracker.primer_aviso_enviado) {
        enviarNotificacion = true;
        bodyText = `Asistencia: ${presentes} de ${esperados} registrados (${porcentaje}%). ${pendientes} pendientes.`;
        
        updatesTracker = {
          primer_aviso_enviado: true,
          primer_aviso_at: new Date().toISOString(),
          ultimo_aviso_at: new Date().toISOString(),
          ultimo_total_presentes: presentes,
          nuevas_marcaciones_desde: null
        };
      } 
      // 7. Evaluar Nuevas Marcaciones (Una vez enviado el primer aviso)
      else if (tracker.primer_aviso_enviado) {
        if (presentes > tracker.ultimo_total_presentes) {
          if (!tracker.nuevas_marcaciones_desde) {
            // Registrar inicio de la ventana de agrupación
            updatesTracker = {
              nuevas_marcaciones_desde: new Date().toISOString()
            };
          } else {
            const minutosAgrupados = (now.getTime() - new Date(tracker.nuevas_marcaciones_desde).getTime()) / (1000 * 60);
            if (minutosAgrupados >= AGRUPACION_MINS) {
              enviarNotificacion = true;
              const nuevas = presentes - tracker.ultimo_total_presentes;
              bodyText = `Actualización: ${presentes} de ${esperados} registrados (${porcentaje}%). ${nuevas} nuevos ingresos.`;
              
              updatesTracker = {
                ultimo_aviso_at: new Date().toISOString(),
                ultimo_total_presentes: presentes,
                nuevas_marcaciones_desde: null
              };
            }
          }
        }
      }

      // 8. Despachar notificaciones si es requerido
      if (enviarNotificacion) {
        // Consultar el Staff asociado al curso
        const { data: staffList, error: staffErr } = await supabase
          .from("staff_instruccion")
          .select("id")
          .eq("tenant_id", rule.tenant_id)
          .eq("curso_id", rule.curso_id)
          .eq("activo", true);

        if (staffErr) throw staffErr;

        if (staffList && staffList.length > 0) {
          const staffIds = staffList.map(s => s.id);
          
          // Consultar las suscripciones Web Push activas del Staff
          const { data: subs, error: subErr } = await supabase
            .from("staff_push_subscriptions")
            .select("*")
            .eq("tenant_id", rule.tenant_id)
            .in("staff_id", staffIds)
            .eq("estado", "activo");

          if (subErr) throw subErr;

          if (subs && subs.length > 0) {
            const payload = JSON.stringify({
              title: "asistIA Staff",
              body: bodyText,
              url: `/staff-asistencia/?tenant=${encodeURIComponent(rule.tenant_id)}`
            });

            for (const sub of subs) {
              const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth
                }
              };
              
              try {
                await webpush.sendNotification(pushSubscription, payload);
              } catch (error: any) {
                console.warn(`[cron-push] Error al notificar suscripción ${sub.id}:`, error.message);
                if (error.statusCode === 404 || error.statusCode === 410) {
                  await supabase
                    .from("staff_push_subscriptions")
                    .update({ estado: "inactivo", updated_at: new Date().toISOString() })
                    .eq("id", sub.id);
                }
              }
            }
          }
        }

        // D. Nuevo canal de destinatarios: usuarios de backoffice
        // (Superusuario y Administrador, incluyendo el perfil "Staff", que
        // es un sub-nivel de permisos dentro de rol='administrador'). Va
        // dentro del mismo if (enviarNotificacion) que el bloque de staff,
        // por lo que comparte su misma protección de idempotencia del
        // tracker -- no se reenvía en ciclos sucesivos del cron mientras la
        // condición no vuelva a cumplirse. Envuelto en su propio try/catch
        // para que un fallo aquí no aborte el procesamiento de esta regla
        // ni el de las siguientes.
        try {
          const destinatariosBackoffice = backofficeSubs.filter(sub => {
            const ua = sub.ua;
            if (!ua || ua.activo !== true) return false;
            if (ua.rol === "super_admin") return true;
            return ua.rol === "administrador" && ua.tenant_id === rule.tenant_id;
          });

          if (destinatariosBackoffice.length > 0) {
            const nombreInstitucion = institucionesMap.get(rule.tenant_id)?.nombre || rule.tenant_id;

            for (const sub of destinatariosBackoffice) {
              const esSuperAdmin = sub.ua.rol === "super_admin";
              const payloadBackoffice = JSON.stringify({
                title: "asistIA Backoffice",
                body: esSuperAdmin ? `${nombreInstitucion}: ${bodyText}` : bodyText,
                url: `/index.html?tenant=${encodeURIComponent(rule.tenant_id)}`
              });

              const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth
                }
              };

              try {
                await webpush.sendNotification(pushSubscription, payloadBackoffice);
              } catch (error: any) {
                console.warn(`[cron-push] Error al notificar suscripción backoffice ${sub.id}:`, error.message);
                if (error.statusCode === 404 || error.statusCode === 410) {
                  await supabase
                    .from("backoffice_push_subscriptions")
                    .update({ estado: "inactivo", updated_at: new Date().toISOString() })
                    .eq("id", sub.id);
                }
              }
            }
          }
        } catch (error: any) {
          console.warn(`[cron-push] Error en despacho de backoffice para ${rule.tenant_id}:`, error.message);
        }
      }

      // Actualizar tracker en DB si hay cambios
      if (Object.keys(updatesTracker).length > 0) {
        const { error: updErr } = await supabase
          .from("staff_push_tracker")
          .update({ ...updatesTracker, updated_at: new Date().toISOString() })
          .eq("id", tracker.id);

        if (updErr) throw updErr;
      }

      resultados.push({
        jornada: jornadaCodigo,
        status: enviarNotificacion ? "notificado" : "pendiente_evaluacion",
        presentes,
        esperados
      });
    }

    return new Response(JSON.stringify({ success: true, resultados }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
})

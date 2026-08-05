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
    const { staff_id, tenant_id, title, body } = await req.json()

    if (!staff_id || !tenant_id) {
      return new Response(JSON.stringify({ error: "staff_id y tenant_id son requeridos" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Obtener suscripciones activas del Staff
    const { data: subs, error: err } = await supabase
      .from("staff_push_subscriptions")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("staff_id", staff_id)
      .eq("estado", "activo")

    if (err || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ error: "Suscripción activa no encontrada para el Staff" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      })
    }

    let enviados = 0
    let fallidos = 0
    const detalles: any[] = []

    for (const sub of subs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      }

      const payload = JSON.stringify({
        title: title || "asistIA Staff",
        body: body || "Notificación de prueba",
        url: `/staff-asistencia/?tenant=${encodeURIComponent(tenant_id)}`
      })

      try {
        await webpush.sendNotification(pushSubscription, payload)
        enviados++
        detalles.push({ id: sub.id, status: "success" })
      } catch (error: any) {
        fallidos++
        detalles.push({ id: sub.id, status: "failed", error: error.message })

        // Desactivación ante error 404 o 410 (Gone)
        if (error.statusCode === 404 || error.statusCode === 410) {
          console.warn(`[push] Suscripción expirada (${error.statusCode}) para endpoint: ${sub.endpoint}. Desactivando...`)
          await supabase
            .from("staff_push_subscriptions")
            .update({ estado: "inactivo", updated_at: new Date().toISOString() })
            .eq("id", sub.id)
        }
      }
    }

    return new Response(JSON.stringify({ success: true, enviados, fallidos, detalles }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  }
})

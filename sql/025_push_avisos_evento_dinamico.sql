-- =====================================================================
-- SCRIPT DE BASE DE DATOS: AVISOS PUSH POR EVENTO (3 AVISOS FIJOS)
-- File: sql/025_push_avisos_evento_dinamico.sql
-- =====================================================================
-- Reemplaza el modelo de cron fijo cada minuto (sql/021) por un modelo
-- disparado por evento: el primer registro de staff_asistencias del día
-- para una jornada/tenant/curso programa dinámicamente un cron temporal
-- acotado a esa jornada, que se autodesprograma al finalizar. Un cron de
-- limpieza horario actúa como red de seguridad ante jobs huérfanos.
--
-- NOTA (actualizada tras el despliegue de la nueva Edge Function): el cron
-- 'procesar-push-automatico-staff' de sql/021 ya NO existe en Supabase --
-- se verificó contra cron.job en producción (no solo contra el repo) y no
-- está programado. sql/021 queda como archivo histórico en el repo, sin
-- efecto real; no hace falta un unschedule explícito porque el job ya no
-- corre. Este archivo (sql/025) solo crea/altera estructura y programa el
-- cron de limpieza.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. staff_push_tracker: columnas del nuevo modelo de 3 avisos fijos
-- ---------------------------------------------------------------------
-- Las columnas primer_aviso_enviado / primer_aviso_at / ultimo_aviso_at /
-- ultimo_total_presentes / nuevas_marcaciones_desde pertenecen al modelo
-- viejo (agrupación dinámica por nuevas marcaciones) y quedan DEPRECATED
-- en esta migración -- no se leen ni se escriben desde la nueva Edge
-- Function. Se conservan un ciclo en producción por si hace falta
-- rollback rápido; se retiran en una migración aparte una vez validado.

COMMENT ON COLUMN public.staff_push_tracker.primer_aviso_enviado IS
    'DEPRECATED (sql/025): modelo viejo de agrupación por nuevas marcaciones. Reemplazado por aviso1_enviado_at. Pendiente de retiro en migración aparte.';
COMMENT ON COLUMN public.staff_push_tracker.primer_aviso_at IS
    'DEPRECATED (sql/025): ver aviso1_enviado_at.';
COMMENT ON COLUMN public.staff_push_tracker.ultimo_aviso_at IS
    'DEPRECATED (sql/025): el nuevo modelo usa aviso1_enviado_at / aviso2_enviado_at / aviso3_enviado_at.';
COMMENT ON COLUMN public.staff_push_tracker.ultimo_total_presentes IS
    'DEPRECATED (sql/025): reemplazado por corte1_presentes / corte2_presentes / corte3_presentes.';
COMMENT ON COLUMN public.staff_push_tracker.nuevas_marcaciones_desde IS
    'DEPRECATED (sql/025): pertenecía al modelo de agrupación (AGRUPACION_MINS), retirado.';

ALTER TABLE public.staff_push_tracker
    -- Regla de jornada resuelta por el trigger al programar este tracker.
    -- ON DELETE SET NULL: si el admin edita/borra la regla desde el
    -- backoffice después de programada la jornada, no debe romper el
    -- tracker ya en curso.
    ADD COLUMN IF NOT EXISTS regla_id UUID NULL
        REFERENCES public.curso_jornada_reglas(id) ON DELETE SET NULL,

    -- Aviso 1: corte de datos a T+15, envío a T+30 (colchón fijo 15 min)
    ADD COLUMN IF NOT EXISTS corte1_en TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS corte1_presentes INT NULL,
    ADD COLUMN IF NOT EXISTS aviso1_en TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS aviso1_enviado_at TIMESTAMPTZ NULL,

    -- Aviso 2: 60 min después de aviso1, mismo colchón de 15 min
    ADD COLUMN IF NOT EXISTS corte2_en TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS corte2_presentes INT NULL,
    ADD COLUMN IF NOT EXISTS aviso2_en TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS aviso2_enviado_at TIMESTAMPTZ NULL,

    -- Aviso 3 (FINAL): 60 min después de aviso2, mismo colchón de 15 min.
    -- Formato de envío distinto (total simple sin desglose de corte), pero
    -- el mecanismo de captura del dato (corte a -15min) es igual a 1 y 2.
    ADD COLUMN IF NOT EXISTS corte3_en TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS corte3_presentes INT NULL,
    ADD COLUMN IF NOT EXISTS aviso3_en TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS aviso3_enviado_at TIMESTAMPTZ NULL,

    -- Nombre del job pg_cron temporal asociado a esta jornada, para que la
    -- Edge Function se autodesprograme al finalizar y para que el cron de
    -- limpieza (paso 4) sepa qué job(s) buscar sin parsear cron.job.
    ADD COLUMN IF NOT EXISTS cron_job_name TEXT NULL;

CREATE INDEX IF NOT EXISTS staff_push_tracker_cron_job_idx
    ON public.staff_push_tracker (cron_job_name)
    WHERE cron_job_name IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2. Trigger: primer registro de staff_asistencias del día -> programa
--    el tracker + cron temporal de esa jornada
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_iniciar_push_jornada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ya_existe BOOLEAN;
    v_regla_id UUID;
    v_hora_inicio TIME;
    v_dow SMALLINT;
    v_jornada_inicio_at TIMESTAMPTZ;
    v_corte1_en TIMESTAMPTZ;
    v_aviso1_en TIMESTAMPTZ;
    v_corte2_en TIMESTAMPTZ;
    v_aviso2_en TIMESTAMPTZ;
    v_corte3_en TIMESTAMPTZ;
    v_aviso3_en TIMESTAMPTZ;
    v_job_name TEXT;
BEGIN
    -- Caso B (curso_id NULL): no hay forma de saber a qué jornada
    -- pertenece este registro de staff. No bloquea el INSERT del staff,
    -- pero se deja rastro en actividad_logs para poder medir a futuro qué
    -- tan frecuente es este caso, en vez de que sea completamente
    -- silencioso.
    IF NEW.curso_id IS NULL THEN
        BEGIN
            INSERT INTO public.actividad_logs (
                fecha, accion, usuario, rol, tenant_id, tenant_nombre,
                entorno, ruta, device_label, device_id, detalle, curso_id
            ) VALUES (
                now(), 'push_jornada_omitido_curso_null', 'Sistema de Push', 'sistema',
                NEW.tenant_id, '', 'sistema', 'fn_iniciar_push_jornada',
                'Trigger staff_asistencias', COALESCE(NEW.device_id, ''),
                jsonb_build_object(
                    'motivo', 'staff_asistencias.curso_id es NULL, no se puede resolver jornada',
                    'staff_asistencia_id', NEW.id,
                    'staff_id', NEW.staff_id,
                    'codigo_bombero', NEW.codigo_bombero,
                    'fecha', NEW.fecha
                ),
                NULL
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'fn_iniciar_push_jornada: fallo al registrar log de curso_id NULL: %', SQLERRM;
        END;
        RETURN NEW;
    END IF;

    -- Si ya existe tracker para (tenant, curso, fecha), no es el primer
    -- registro del día: el cron de esta jornada ya está vivo (o ya
    -- finalizó). No se reprograma.
    SELECT EXISTS (
        SELECT 1 FROM public.staff_push_tracker
        WHERE tenant_id = NEW.tenant_id
          AND curso_id = NEW.curso_id
          AND fecha_jornada = NEW.fecha
    ) INTO v_ya_existe;

    IF v_ya_existe THEN
        RETURN NEW;
    END IF;

    -- Resolver la curso_jornada_reglas vigente para (tenant, curso) en la
    -- fecha del registro. staff_asistencias no tiene columna "seccion"
    -- (a diferencia de aspirantes), así que a diferencia del ranking de
    -- fn_resolver_contexto_asistencia (sql/012) NO se puede usar la
    -- sección como criterio de desempate -- se resuelve solo por
    -- fecha_especifica > prioridad_resolucion > hora_inicio > id.
    v_dow := extract(dow FROM NEW.fecha::timestamp)::smallint;

    SELECT r.id, r.hora_inicio
    INTO v_regla_id, v_hora_inicio
    FROM public.curso_jornada_reglas r
    WHERE r.tenant_id = NEW.tenant_id
      AND r.curso_id = NEW.curso_id
      AND r.activa = true
      AND (
            r.fecha_especifica = NEW.fecha
            OR (
                r.fecha_especifica IS NULL
                AND (r.vigente_desde IS NULL OR NEW.fecha >= r.vigente_desde)
                AND (r.vigente_hasta IS NULL OR NEW.fecha <= r.vigente_hasta)
                AND r.dias_semana IS NOT NULL
                AND v_dow = ANY(r.dias_semana)
            )
          )
    ORDER BY
        CASE WHEN r.fecha_especifica = NEW.fecha THEN 0 ELSE 1 END ASC,
        r.prioridad_resolucion ASC,
        r.hora_inicio ASC,
        r.id ASC
    LIMIT 1;

    -- Sin regla resuelta: no se sabe la hora de inicio de la jornada, no
    -- se puede programar nada. No se considera el mismo caso que B (esto
    -- es "no hay jornada configurada", no "falta curso_id"), así que no
    -- se duplica el log de actividad aquí.
    IF v_regla_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Timestamps de la jornada. Mismo criterio de huso horario fijo
    -- America/Lima (-05:00) que ya usa process-auto-push/index.ts para
    -- evitar depender de la zona horaria configurada en el servidor.
    v_jornada_inicio_at := (NEW.fecha::text || ' ' || v_hora_inicio::text || '-05:00')::timestamptz;
    v_corte1_en  := v_jornada_inicio_at + interval '15 minutes';
    v_aviso1_en  := v_jornada_inicio_at + interval '30 minutes';
    v_corte2_en  := v_aviso1_en + interval '45 minutes';   -- T+75
    v_aviso2_en  := v_aviso1_en + interval '60 minutes';   -- T+90
    v_corte3_en  := v_aviso2_en + interval '45 minutes';   -- T+135
    v_aviso3_en  := v_aviso2_en + interval '60 minutes';   -- T+150

    v_job_name := 'push-aviso-' || NEW.tenant_id || '-' || NEW.curso_id || '-' || NEW.fecha::text;

    BEGIN
        INSERT INTO public.staff_push_tracker (
            tenant_id, curso_id, fecha_jornada, jornada_inicio_at,
            regla_id, corte1_en, aviso1_en, corte2_en, aviso2_en,
            corte3_en, aviso3_en, cron_job_name, finalizado
        ) VALUES (
            NEW.tenant_id, NEW.curso_id, NEW.fecha, v_jornada_inicio_at,
            v_regla_id, v_corte1_en, v_aviso1_en, v_corte2_en, v_aviso2_en,
            v_corte3_en, v_aviso3_en, v_job_name, false
        );
    EXCEPTION WHEN unique_violation THEN
        -- Carrera entre dos registros de staff casi simultáneos: el
        -- primero en confirmar el INSERT gana y programa el cron; este
        -- otro simplemente no reprograma nada. No es un error real.
        RETURN NEW;
    END;

    -- La service_role key NO se resuelve aquí ni se hornea en el comando
    -- del job: cada ejecución del cron temporal la busca en el Vault en
    -- tiempo real (mismo patrón que sql/021), para que nunca quede texto
    -- plano de la clave almacenado en cron.job/cron.job_run_details.
    -- Solo tenant_id/curso_id/fecha_jornada (no sensibles) se hornean vía
    -- format(%L, ...) en el comando de este job específico.
    PERFORM cron.schedule(
        v_job_name,
        '*/5 * * * *',
        format(
            $fmt$
            DO $do$
            DECLARE
                v_key TEXT;
            BEGIN
                SELECT decrypted_secret INTO v_key
                FROM vault.decrypted_secrets
                WHERE name = 'service_role' OR name = 'service_role_key'
                LIMIT 1;

                IF v_key IS NULL THEN
                    RAISE EXCEPTION 'La clave service_role no se encuentra configurada en el Vault de Supabase.';
                END IF;

                PERFORM net.http_post(
                    url := 'https://kcapmyovaigjntaqeqwn.supabase.co/functions/v1/process-auto-push',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_key
                    ),
                    body := jsonb_build_object(
                        'tenant_id', %L,
                        'curso_id', %L,
                        'fecha_jornada', %L
                    )
                );
            END;
            $do$;
            $fmt$,
            NEW.tenant_id, NEW.curso_id, NEW.fecha::text
        )
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Resiliencia: un fallo en la programación del push NUNCA debe
    -- bloquear el registro real de asistencia del staff.
    RAISE WARNING 'fn_iniciar_push_jornada: fallo inesperado: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iniciar_push_jornada ON public.staff_asistencias;

CREATE TRIGGER trg_iniciar_push_jornada
AFTER INSERT ON public.staff_asistencias
FOR EACH ROW
EXECUTE FUNCTION public.fn_iniciar_push_jornada();


-- ---------------------------------------------------------------------
-- 3. RPC para que la Edge Function se autodesprograme al finalizar
-- ---------------------------------------------------------------------
-- Solo service_role puede llamarla: exponerla a anon/authenticated
-- permitiría desprogramar el cron de cualquier tenant conociendo (o
-- adivinando) el nombre del job.
CREATE OR REPLACE FUNCTION public.rpc_unschedule_push_cron(p_job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM cron.unschedule(p_job_name);
EXCEPTION WHEN OTHERS THEN
    -- Job ya no existe o falló el unschedule: el cron de limpieza (paso 4)
    -- lo cubre igual, no hace falta propagar el error a la Edge Function.
    NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_unschedule_push_cron(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_unschedule_push_cron(text) TO service_role;


-- ---------------------------------------------------------------------
-- 4. Cron de limpieza (permanente, cada hora): red de seguridad para
--    jobs temporales huérfanos (ej. si el self-unschedule falló)
-- ---------------------------------------------------------------------
SELECT cron.unschedule('limpieza-push-jornadas-huerfanas')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpieza-push-jornadas-huerfanas');

SELECT cron.schedule(
    'limpieza-push-jornadas-huerfanas',
    '0 * * * *',
    $cron$
    DO $do$
    DECLARE r RECORD;
    BEGIN
        FOR r IN
            SELECT cron_job_name FROM public.staff_push_tracker
            WHERE cron_job_name IS NOT NULL
              AND (finalizado = true OR now() - jornada_inicio_at > interval '6 hours')
        LOOP
            BEGIN
                PERFORM cron.unschedule(r.cron_job_name);
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
            UPDATE public.staff_push_tracker
            SET cron_job_name = NULL
            WHERE cron_job_name = r.cron_job_name;
        END LOOP;
    END;
    $do$;
    $cron$
);

COMMIT;

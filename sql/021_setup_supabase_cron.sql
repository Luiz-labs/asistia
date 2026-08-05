-- =====================================================================
-- SCRIPT DE BASE DE DATOS: PROGRAMACIÓN DEL CRON JOB (MINUTO A MINUTO)
-- File: sql/021_setup_supabase_cron.sql
-- =====================================================================

-- NOTA IMPORTANTE DE INFRAESTRUCTURA:
-- Para ejecutar este script, es necesario que las extensiones pg_cron y pg_net
-- estén activadas en tu proyecto de Supabase (Database -> Extensions -> Activar 'pg_cron' y 'pg_net').

BEGIN;

-- 1. Desprogramar si ya existía para evitar duplicación
SELECT cron.unschedule('procesar-push-automatico-staff');

-- 2. Programar la invocación cada minuto de la Edge Function process-auto-push.
-- NOTA DE SEGURIDAD:
-- Para mantener la verificación de JWT activa (función protegida) sin hardcodear
-- la SERVICE_ROLE_KEY en el repositorio o base de datos, extraemos la clave de forma
-- dinámica del Vault de Supabase ('vault.decrypted_secrets') en tiempo de ejecución.
SELECT cron.schedule(
  'procesar-push-automatico-staff',
  '* * * * *', -- Ejecutar cada minuto
  $cron$
  DO $do$
  DECLARE
    v_key TEXT;
  BEGIN
    -- Obtener la clave de servicio desde el almacenamiento seguro del Vault
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'service_role' OR name = 'service_role_key' 
    LIMIT 1;

    IF v_key IS NULL THEN
      RAISE EXCEPTION 'La clave service_role no se encuentra configurada en el Vault de Supabase.';
    END IF;

    -- Invocar la Edge Function de forma segura enviando la clave en la cabecera Authorization
    PERFORM net.http_post(
      url := 'https://kcapmyovaigjntaqeqwn.supabase.co/functions/v1/process-auto-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := '{}'::jsonb
    );
  END;
  $do$;
  $cron$
);

COMMIT;

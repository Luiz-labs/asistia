-- Migration: Preparar actividad_logs para Timeline Paginado y Multitenant
-- File: sql/008_preparar_actividad_logs_timeline.sql
--
-- Descripción:
-- 1. Agrega la columna curso_id a la tabla actividad_logs de forma no bloqueante.
-- 2. Recrea la función fn_autogenerar_actividad_operativa para mapear curso_id.
-- 3. Crea el índice compuesto idx_actividad_logs_tenant_curso_fecha para optimizar el paginado.
-- 4. Ejecuta un backfill seguro de curso_id para las filas de asistencia y alertas existentes.

BEGIN;

-- =========================================================================
-- PASO 1: Alteración del Schema (No Bloqueante)
-- =========================================================================
ALTER TABLE public.actividad_logs ADD COLUMN IF NOT EXISTS curso_id bigint;

-- =========================================================================
-- PASO 2: Actualización de la Función del Trigger (Captura de curso_id)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_autogenerar_actividad_operativa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_detalle JSONB;
    v_accion TEXT;
    v_usuario TEXT;
    v_rol TEXT;
    v_entorno TEXT := 'sistema';
    v_ruta TEXT;
BEGIN
    IF TG_TABLE_NAME = 'asistencias' THEN
        v_accion := 'asistencia_registrada';
        v_usuario := COALESCE(NEW.nombre, NEW.dni, 'Aspirante');
        v_rol := 'aspirante';
        v_ruta := COALESCE(NEW.origen_registro, 'qr_publico');
        
        v_detalle := jsonb_build_object(
            'dni', NEW.dni,
            'nombre', COALESCE(NEW.nombre, 'Sin Nombre'),
            'seccion', COALESCE(NEW.seccion, '-'),
            'hora', NEW.hora,
            'jornada', COALESCE(NEW.tipo_jornada, 'Jornada')
        );

        INSERT INTO public.actividad_logs (
            fecha, accion, usuario, rol, tenant_id, curso_id, tenant_nombre,
            entorno, ruta, device_label, device_id, detalle
        ) VALUES (
            COALESCE(NEW.created_at, now()), v_accion, v_usuario, v_rol, NEW.tenant_id, NEW.curso_id, '',
            v_entorno, v_ruta, 'Dispositivo Móvil', COALESCE(NEW.device_id, ''), v_detalle
        );

    ELSIF TG_TABLE_NAME = 'asistencia_alertas' THEN
        v_accion := 'alerta_generada';
        v_usuario := 'Sistema de Seguridad';
        v_rol := 'sistema';
        v_ruta := 'rpc_registrar_asistencia_v2';
        
        v_detalle := jsonb_build_object(
            'dni', NEW.dni,
            'nombre', COALESCE(NEW.nombre, 'Aspirante'),
            'tipo_alerta', NEW.tipo,
            'detalle', NEW.detalle,
            'device_id', COALESCE(NEW.device_id, '')
        );

        INSERT INTO public.actividad_logs (
            fecha, accion, usuario, rol, tenant_id, curso_id, tenant_nombre,
            entorno, ruta, device_label, device_id, detalle
        ) VALUES (
            COALESCE(NEW.created_at, now()), v_accion, v_usuario, v_rol, NEW.tenant_id, NEW.curso_id, '',
            v_entorno, v_ruta, 'Detección Automática', COALESCE(NEW.device_id, ''), v_detalle
        );
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Resiliencia: Si falla la auditoría, jamás bloquea la marcación principal del alumno.
    RAISE WARNING 'Fallo al autogenerar log de actividad: %', SQLERRM;
    RETURN NEW;
END;
$function$;

-- Re-vincular triggers para aplicar la nueva versión de la función
DROP TRIGGER IF EXISTS trg_autogenerar_actividad_asistencias ON public.asistencias;
CREATE TRIGGER trg_autogenerar_actividad_asistencias
AFTER INSERT ON public.asistencias
FOR EACH ROW
EXECUTE FUNCTION public.fn_autogenerar_actividad_operativa();

DROP TRIGGER IF EXISTS trg_autogenerar_actividad_alertas ON public.asistencia_alertas;
CREATE TRIGGER trg_autogenerar_actividad_alertas
AFTER INSERT ON public.asistencia_alertas
FOR EACH ROW
EXECUTE FUNCTION public.fn_autogenerar_actividad_operativa();

-- =========================================================================
-- PASO 3: Indexación de Alto Rendimiento
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_actividad_logs_tenant_curso_fecha 
ON public.actividad_logs (tenant_id, curso_id, fecha DESC);

-- =========================================================================
-- PASO 4: Backfill Controlado de curso_id en Datos Existentes
-- =========================================================================

-- Backfill para registros de Asistencia
UPDATE public.actividad_logs l
SET curso_id = a.curso_id
FROM public.asistencias a
WHERE l.accion = 'asistencia_registrada'
  AND l.tenant_id = a.tenant_id
  AND (l.detalle->>'dni') = a.dni
  AND l.fecha = a.created_at
  AND l.curso_id IS NULL;

-- Backfill para registros de Alertas
UPDATE public.actividad_logs l
SET curso_id = al.curso_id
FROM public.asistencia_alertas al
WHERE l.accion = 'alerta_generada'
  AND l.tenant_id = al.tenant_id
  AND (l.detalle->>'dni') = al.dni
  AND l.fecha = al.created_at
  AND l.curso_id IS NULL;

-- Fallback por defecto para logs de sesión u otros
UPDATE public.actividad_logs
SET curso_id = 1
WHERE curso_id IS NULL 
  AND tenant_id IS NOT NULL;

COMMIT;

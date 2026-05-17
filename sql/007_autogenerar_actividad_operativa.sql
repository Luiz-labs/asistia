-- Migration: Autogenerar Actividad Operativa en AsistIA
-- File: sql/007_autogenerar_actividad_operativa.sql
--
-- Descripción:
-- Implementa triggers de base de datos Postgres que detectan de forma automatizada
-- las inserciones de asistencias (mobile/RPC/contingencia) y alertas de marcación.
-- Registra eventos en formato legible por humanos en la tabla `actividad_logs`,
-- convirtiendo el log en un timeline operativo interactivo y multitenant.
-- De esta forma, el Backoffice refleja en tiempo real toda la actividad real del sistema
-- sin requerir cambios complejos en el frontend o localStorage del administrador.

BEGIN;

-- 1. Crear o reemplazar la función generadora de logs operativos
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
            fecha,
            accion,
            usuario,
            rol,
            tenant_id,
            tenant_nombre,
            entorno,
            ruta,
            device_label,
            device_id,
            detalle
        ) VALUES (
            COALESCE(NEW.created_at, now()),
            v_accion,
            v_usuario,
            v_rol,
            NEW.tenant_id,
            '',
            v_entorno,
            v_ruta,
            'Dispositivo Móvil',
            COALESCE(NEW.device_id, ''),
            v_detalle
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
            fecha,
            accion,
            usuario,
            rol,
            tenant_id,
            tenant_nombre,
            entorno,
            ruta,
            device_label,
            device_id,
            detalle
        ) VALUES (
            COALESCE(NEW.created_at, now()),
            v_accion,
            v_usuario,
            v_rol,
            NEW.tenant_id,
            '',
            v_entorno,
            v_ruta,
            'Detección Automática',
            COALESCE(NEW.device_id, ''),
            v_detalle
        );
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Resiliencia operativa: Si falla la generación de auditoría, jamás bloquea la marcación principal.
    RAISE WARNING 'Fallo al autogenerar log de actividad: %', SQLERRM;
    RETURN NEW;
END;
$function$;

-- 2. Vincular trigger para Asistencias
DROP TRIGGER IF EXISTS trg_autogenerar_actividad_asistencias ON public.asistencias;
CREATE TRIGGER trg_autogenerar_actividad_asistencias
AFTER INSERT ON public.asistencias
FOR EACH ROW
EXECUTE FUNCTION public.fn_autogenerar_actividad_operativa();

-- 3. Vincular trigger para Alertas
DROP TRIGGER IF EXISTS trg_autogenerar_actividad_alertas ON public.asistencia_alertas;
CREATE TRIGGER trg_autogenerar_actividad_alertas
AFTER INSERT ON public.asistencia_alertas
FOR EACH ROW
EXECUTE FUNCTION public.fn_autogenerar_actividad_operativa();

COMMIT;

-- Migration: Crear Módulo de Justificaciones y Configuración Operativa
-- File: sql/009_create_justificaciones.sql
--

BEGIN;

-- 1. Crear tabla de justificaciones
CREATE TABLE IF NOT EXISTS public.justificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    curso_id BIGINT NOT NULL,
    dni VARCHAR(8) NOT NULL,
    nombre TEXT NOT NULL,
    apellido TEXT NOT NULL,
    ubo TEXT NOT NULL,
    seccion TEXT NOT NULL,
    fecha_justificada DATE NOT NULL,
    archivo_path TEXT NOT NULL, -- Almacena la ruta del archivo en Storage
    archivo_nombre TEXT NOT NULL,
    archivo_tipo TEXT NOT NULL,
    fecha_registro_dispositivo DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_registro_dispositivo TIME NOT NULL DEFAULT CURRENT_TIME,
    timezone TEXT NOT NULL DEFAULT 'America/Lima',
    device_id TEXT NOT NULL,
    estado_revision TEXT NOT NULL DEFAULT 'RECIBIDA' CHECK (estado_revision IN ('RECIBIDA', 'APROBADA', 'RECHAZADA')),
    observacion_revision TEXT,
    usuario_revision TEXT,
    fecha_revision TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices optimizados
CREATE INDEX IF NOT EXISTS idx_justificaciones_tenant_curso ON public.justificaciones (tenant_id, curso_id);
CREATE INDEX IF NOT EXISTS idx_justificaciones_dni ON public.justificaciones (dni);
CREATE INDEX IF NOT EXISTS idx_justificaciones_fecha_justificada ON public.justificaciones (fecha_justificada);

-- 2. Alterar curso_configuracion para alojar la Configuración Operativa
ALTER TABLE public.curso_configuracion ADD COLUMN IF NOT EXISTS oper_justif_plazo_dias INT DEFAULT 3;
ALTER TABLE public.curso_configuracion ADD COLUMN IF NOT EXISTS oper_justif_doc_obligatorio BOOLEAN DEFAULT TRUE;
ALTER TABLE public.curso_configuracion ADD COLUMN IF NOT EXISTS oper_justif_max_size_mb NUMERIC DEFAULT 2.0; -- Reducido a 2MB según mitigación
ALTER TABLE public.curso_configuracion ADD COLUMN IF NOT EXISTS oper_justif_tipos_permitidos TEXT DEFAULT 'pdf,jpg,jpeg,png';

-- 3. Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.set_justificaciones_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_justificaciones_updated_at ON public.justificaciones;
CREATE TRIGGER trg_justificaciones_updated_at
BEFORE UPDATE ON public.justificaciones
FOR EACH ROW
EXECUTE FUNCTION public.set_justificaciones_updated_at();

-- 4. Trigger automatizado para registrar Actividad Operativa en actividad_logs
CREATE OR REPLACE FUNCTION public.fn_autogenerar_actividad_justificaciones()
RETURNS TRIGGER AS $$
DECLARE
    v_detalle JSONB;
    v_accion TEXT;
    v_usuario TEXT;
    v_rol TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_accion := CASE 
            WHEN NEW.estado_revision = 'RECIBIDA' AND NEW.device_id LIKE 'offline%' THEN 'justificacion_sincronizada'
            ELSE 'justificacion_creada'
        END;
        v_usuario := NEW.nombre || ' ' || NEW.apellido;
        v_rol := 'aspirante';
        v_detalle := jsonb_build_object(
            'dni', NEW.dni,
            'fecha_justificada', NEW.fecha_justificada,
            'archivo_nombre', NEW.archivo_nombre,
            'estado', NEW.estado_revision
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.estado_revision <> NEW.estado_revision THEN
            v_accion := CASE NEW.estado_revision
                WHEN 'APROBADA' THEN 'justificacion_aprobada'
                WHEN 'RECHAZADA' THEN 'justificacion_rechazada'
                ELSE 'justificacion_modificada'
            END;
            v_usuario := COALESCE(NEW.usuario_revision, 'administrador');
            v_rol := 'administrador';
            v_detalle := jsonb_build_object(
                'dni', NEW.dni,
                'aspirante', NEW.nombre || ' ' || NEW.apellido,
                'fecha_justificada', NEW.fecha_justificada,
                'observacion', NEW.observacion_revision,
                'estado', NEW.estado_revision
            );
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.actividad_logs (
        fecha, accion, usuario, rol, tenant_id, curso_id, tenant_nombre,
        entorno, ruta, device_label, device_id, detalle
    ) VALUES (
        NOW(), v_accion, v_usuario, v_rol, NEW.tenant_id, NEW.curso_id, '',
        'sistema', '/justificaciones', 'Servicio de Justificaciones', NEW.device_id, v_detalle
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_justificaciones_actividad ON public.justificaciones;
CREATE TRIGGER trg_justificaciones_actividad
AFTER INSERT OR UPDATE ON public.justificaciones
FOR EACH ROW
EXECUTE FUNCTION public.fn_autogenerar_actividad_justificaciones();

-- 5. RPC validar fecha justificable
CREATE OR REPLACE FUNCTION public.rpc_validar_fecha_justificable(
    p_tenant_id TEXT,
    p_curso_id BIGINT,
    p_dni TEXT,
    p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_seccion TEXT;
    v_has_asistencia BOOLEAN := FALSE;
    v_asistencia_estado TEXT;
    v_ctx jsonb;
    v_timestamp TIMESTAMPTZ;
    v_qr_token TEXT;
BEGIN
    -- 1. Verificar si el aspirante existe y obtener su sección
    SELECT upper(trim(coalesce(seccion, '')))
      INTO v_seccion
    FROM public.aspirantes
    WHERE tenant_id = p_tenant_id
      AND curso_id = p_curso_id
      AND dni = p_dni
      AND estado <> 'retirado'
    LIMIT 1;

    IF v_seccion IS NULL THEN
        RETURN jsonb_build_object(
            'justificable', false,
            'reason', 'El DNI ingresado no pertenece a un aspirante activo.'
        );
    END IF;

    -- 2. Buscar si existe asistencia registrada en esa fecha
    SELECT true, estado_asistencia
      INTO v_has_asistencia, v_asistencia_estado
    FROM public.asistencias
    WHERE tenant_id = p_tenant_id
      AND curso_id = p_curso_id
      AND dni = p_dni
      AND fecha = p_fecha
    LIMIT 1;

    IF v_has_asistencia THEN
        -- Si existe asistencia, solo es justificable si tiene Tardanza o Fuera de Horario
        IF v_asistencia_estado IN ('TARDANZA', 'FUERA_DE_HORARIO') THEN
            RETURN jsonb_build_object(
                'justificable', true,
                'condition', v_asistencia_estado,
                'reason', 'Marcación existente en condición de ' || v_asistencia_estado || '.'
            );
        ELSE
            RETURN jsonb_build_object(
                'justificable', false,
                'reason', 'El aspirante ya cuenta con una asistencia PUNTUAL registrada en la fecha indicada.'
            );
        END IF;
    END IF;

    -- 3. Si no existe asistencia, obtener el qr_token del curso
    SELECT qr_token INTO v_qr_token
    FROM public.cursos
    WHERE tenant_id = p_tenant_id
      AND id = p_curso_id
    LIMIT 1;

    IF v_qr_token IS NULL THEN
        RETURN jsonb_build_object(
            'justificable', false,
            'reason', 'No se pudo resolver el token QR del curso.'
        );
    END IF;

    -- 4. Verificar si había clase programada (Falta / Sin Marcación)
    v_timestamp := (p_fecha::text || ' 12:00:00-05')::timestamptz;
    v_ctx := public.fn_resolver_contexto_asistencia(
        v_qr_token,
        p_dni,
        v_timestamp
    );

    IF coalesce((v_ctx->>'success')::boolean, false) AND v_ctx->>'regla_jornada_id' IS NOT NULL THEN
        RETURN jsonb_build_object(
            'justificable', true,
            'condition', 'FALTA',
            'reason', 'Sin marcación en jornada de clase programada (' || (v_ctx->>'jornada_label') || ').'
        );
    ELSE
        RETURN jsonb_build_object(
            'justificable', false,
            'reason', 'No había ninguna jornada de clases programada para su sección en la fecha indicada.'
        );
    END IF;
END;
$$;

-- 6. Habilitar RLS en justificaciones
ALTER TABLE public.justificaciones ENABLE ROW LEVEL SECURITY;

-- Política de inserción restrictiva
DROP POLICY IF EXISTS justificaciones_insert_public_policy ON public.justificaciones;
CREATE POLICY justificaciones_insert_public_policy ON public.justificaciones
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.aspirantes a
            WHERE a.tenant_id = justificaciones.tenant_id
              AND a.curso_id = justificaciones.curso_id
              AND a.dni = justificaciones.dni
              AND a.estado <> 'retirado'
        )
        AND EXISTS (
            SELECT 1 FROM public.cursos c
            WHERE c.tenant_id = justificaciones.tenant_id
              AND c.id = justificaciones.curso_id
              AND c.estado = 'activo'
        )
    );

-- Política de gestión de administración
DROP POLICY IF EXISTS justificaciones_admin_scoped_policy ON public.justificaciones;
CREATE POLICY justificaciones_admin_scoped_policy ON public.justificaciones
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = justificaciones.tenant_id
        )
    );

COMMIT;

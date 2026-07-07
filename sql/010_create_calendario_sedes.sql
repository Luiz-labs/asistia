-- Migration: Crear Calendario de Sedes y GPS (GPS Fase 1A.2)
-- File: sql/010_create_calendario_sedes.sql
--

BEGIN;

-- 1. Crear tabla de calendario
CREATE TABLE IF NOT EXISTS public.calendario_sedes_gps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    curso_id BIGINT NOT NULL,
    fecha DATE NOT NULL,
    punto_gps_id UUID REFERENCES public.puntos_gps(id) ON DELETE SET NULL,
    hora_inicio TIME NULL,
    tolerancia_minutos INT NOT NULL DEFAULT 30,
    aplica_a TEXT NOT NULL CHECK (aplica_a IN ('TODAS', 'SECCION')),
    seccion TEXT,
    hay_clase BOOLEAN NOT NULL DEFAULT true,
    nota TEXT,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice único compuesto para evitar solapamientos en registros activos
CREATE UNIQUE INDEX IF NOT EXISTS uidx_calendario_sedes_gps_fecha_aplica 
    ON public.calendario_sedes_gps (tenant_id, curso_id, fecha, aplica_a, COALESCE(seccion, ''))
    WHERE (activo = true);

-- Habilitar RLS
ALTER TABLE public.calendario_sedes_gps ENABLE ROW LEVEL SECURITY;

-- Triggers de auditoría para updated_at
CREATE OR REPLACE FUNCTION public.set_calendario_sedes_gps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendario_sedes_gps_updated_at ON public.calendario_sedes_gps;
CREATE TRIGGER trg_calendario_sedes_gps_updated_at
BEFORE UPDATE ON public.calendario_sedes_gps
FOR EACH ROW
EXECUTE FUNCTION public.set_calendario_sedes_gps_updated_at();

-- Políticas RLS (Privadas/Admin)
DROP POLICY IF EXISTS calendario_sedes_gps_admin_policy ON public.calendario_sedes_gps;
CREATE POLICY calendario_sedes_gps_admin_policy ON public.calendario_sedes_gps
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.is_active = true
              AND (
                  p.role IN ('super_admin', 'superusuario') 
                  OR p.tenant_id = calendario_sedes_gps.tenant_id
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.is_active = true
              AND (
                  p.role IN ('super_admin', 'superusuario') 
                  OR p.tenant_id = calendario_sedes_gps.tenant_id
              )
        )
    );

-- 2. RPC segura para resolver la programación del día actual (con validación de hora_inicio nullable)
CREATE OR REPLACE FUNCTION public.rpc_obtener_programacion_dia(
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
    v_reg record;
BEGIN
    -- Validar que el DNI corresponda a un aspirante del mismo tenant/curso
    SELECT upper(trim(coalesce(seccion, ''))) INTO v_seccion
    FROM public.aspirantes
    WHERE tenant_id = p_tenant_id
      AND curso_id = p_curso_id
      AND dni = p_dni
    LIMIT 1;

    IF v_seccion IS NULL THEN
        RETURN jsonb_build_object('success', false, 'reason', 'Aspirante no registrado en el padrón.');
    END IF;

    -- Buscar programación para la sección específica o aplicable a todas
    SELECT 
        cal.hay_clase,
        cal.hora_inicio,
        cal.tolerancia_minutos,
        cal.nota,
        p.id AS punto_id,
        p.tipo_punto,
        p.codigo_punto,
        p.nombre_punto,
        p.latitud,
        p.longitud,
        p.radio_metros
    INTO v_reg
    FROM public.calendario_sedes_gps cal
    LEFT JOIN public.puntos_gps p ON cal.punto_gps_id = p.id
    WHERE cal.tenant_id = p_tenant_id
      AND cal.curso_id = p_curso_id
      AND cal.fecha = p_fecha
      AND cal.activo = true
      AND (cal.aplica_a = 'TODAS' OR (cal.aplica_a = 'SECCION' AND upper(trim(cal.seccion)) = v_seccion))
    ORDER BY (case when cal.aplica_a = 'SECCION' then 1 else 2 end) -- Prioriza sección específica
    LIMIT 1;

    IF v_reg IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'hay_clase', false,
            'reason', 'No hay clase programada para la fecha indicada.'
        );
    END IF;

    -- Validar si hay clase, obligando a que se tenga hora_inicio si hay_clase es verdadero
    IF v_reg.hay_clase AND v_reg.hora_inicio IS NULL THEN
         RETURN jsonb_build_object(
            'success', false,
            'reason', 'Error en la configuración: falta la hora de inicio para el día con clases.'
         );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'hay_clase', v_reg.hay_clase,
        'hora_inicio', v_reg.hora_inicio,
        'tolerancia_minutos', v_reg.tolerancia_minutos,
        'nota', v_reg.nota,
        'punto_gps', case when v_reg.punto_id is not null then jsonb_build_object(
            'id', v_reg.punto_id,
            'tipo_punto', v_reg.tipo_punto,
            'codigo_punto', v_reg.codigo_punto,
            'nombre_punto', v_reg.nombre_punto,
            'latitud', v_reg.latitud,
            'longitud', v_reg.longitud,
            'radio_metros', v_reg.radio_metros
        ) else null end
    );
END;
$$;

COMMIT;

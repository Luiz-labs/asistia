-- =====================================================================
-- SCRIPT DE BASE DE DATOS: CREACIÓN DE TABLA DE SEGUIMIENTO (TRACKER)
-- File: sql/020_create_staff_push_tracker.sql
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_push_tracker (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    curso_id BIGINT NOT NULL,
    fecha_jornada DATE NOT NULL,
    jornada_inicio_at TIMESTAMPTZ NOT NULL,
    primer_aviso_enviado BOOLEAN NOT NULL DEFAULT false,
    primer_aviso_at TIMESTAMPTZ NULL,
    ultimo_aviso_at TIMESTAMPTZ NULL,
    ultimo_total_presentes INT NOT NULL DEFAULT 0,
    nuevas_marcaciones_desde TIMESTAMPTZ NULL,
    finalizado BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT staff_push_tracker_uniq UNIQUE (tenant_id, curso_id, fecha_jornada)
);

-- Habilitar RLS
ALTER TABLE public.staff_push_tracker ENABLE ROW LEVEL SECURITY;

-- Crear política RLS para administradores
DROP POLICY IF EXISTS staff_push_tracker_admin_policy ON public.staff_push_tracker;
CREATE POLICY staff_push_tracker_admin_policy ON public.staff_push_tracker
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = staff_push_tracker.tenant_id
        )
    );

COMMIT;

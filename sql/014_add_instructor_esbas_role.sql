-- =====================================================================
-- SCRIPT DE BASE DE DATOS: AGREGAR TIPO DE STAFF 'INSTRUCTOR ESBAS'
-- (Ejecutar en Supabase SQL Editor)
-- =====================================================================

BEGIN;

-- 1. Buscar y eliminar restricciones de check anteriores en staff_instruccion
DO $$
DECLARE
    v_constraint record;
BEGIN
    FOR v_constraint IN 
        SELECT conname 
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = 'staff_instruccion' 
          AND nsp.nspname = 'public' 
          AND con.contype = 'c'
    LOOP
        EXECUTE 'ALTER TABLE public.staff_instruccion DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint.conname);
    END LOOP;

    -- 2. Buscar y eliminar restricciones de check anteriores en staff_asistencias
    FOR v_constraint IN 
        SELECT conname 
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE rel.relname = 'staff_asistencias' 
          AND nsp.nspname = 'public' 
          AND con.contype = 'c'
    LOOP
        EXECUTE 'ALTER TABLE public.staff_asistencias DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint.conname);
    END LOOP;
END;
$$;

-- 3. Crear las nuevas restricciones CHECK incluyendo 'INSTRUCTOR ESBAS'
ALTER TABLE public.staff_instruccion 
    ADD CONSTRAINT staff_instruccion_tipo_staff_check 
    CHECK (tipo_staff IN ('APOYO', 'ADJUNTO', 'INSTRUCTOR ESBAS'));

ALTER TABLE public.staff_asistencias 
    ADD CONSTRAINT staff_asistencias_tipo_staff_check 
    CHECK (tipo_staff IN ('APOYO', 'ADJUNTO', 'INSTRUCTOR ESBAS'));

COMMIT;

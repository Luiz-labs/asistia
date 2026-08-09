-- =====================================================================
-- MIGRACIÓN DE BASE DE DATOS: AGREGAR COLUMNA DNI A STAFF_INSTRUCCION
-- File: sql/022_add_dni_to_staff_instruccion.sql
-- =====================================================================

BEGIN;

-- 1. Agregar la columna dni como texto (para evitar pérdida de ceros a la izquierda)
-- Se permite NULL para no alterar los registros históricos existentes.
ALTER TABLE public.staff_instruccion
ADD COLUMN IF NOT EXISTS dni text NULL;

-- 2. Agregar un comentario explicativo a la columna
COMMENT ON COLUMN public.staff_instruccion.dni IS 'Documento Nacional de Identidad (8 dígitos numéricos para Perú)';

COMMIT;

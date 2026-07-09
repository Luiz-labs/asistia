-- =====================================================================
-- SCRIPT DE BASE DE DATOS: LIMPIEZA DE EVENTOS HUÉRFANOS Y REASIGNACIÓN
-- (Ejecutar en Supabase SQL Editor para solucionar Fase 1 Urgente)
-- =====================================================================

BEGIN;

-- 1. Reasignar aspirante con DNI 40636507 de sección E a sección F (Activa)
UPDATE public.aspirantes
SET seccion = 'F',
    updated_at = now()
WHERE dni = '40636507'
  AND tenant_id = 'esbas-24'
  AND curso_id = 1;

-- 2. Desactivar lógicamente todos los eventos de calendario de la sección E (Eliminada)
UPDATE public.calendario_sedes_gps
SET activo = false
WHERE tenant_id = 'esbas-24'
  AND curso_id = 1
  AND seccion = 'E'
  AND activo = true;

COMMIT;

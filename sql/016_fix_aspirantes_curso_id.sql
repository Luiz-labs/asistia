-- =====================================================================
-- SCRIPT DE BASE DE DATOS: CORRECCIÓN DE curso_id EN PADRÓN DE ASPIRANTES
-- (Ejecutar en Supabase SQL Editor)
-- =====================================================================

-- 1. CONSULTA PREVIA: Verificar distribución de aspirantes en esbas-24
SELECT 
    COUNT(*) as total_aspirantes_tenant,
    SUM(CASE WHEN curso_id = 1 THEN 1 ELSE 0 END) as con_curso_1,
    SUM(CASE WHEN curso_id IS NULL THEN 1 ELSE 0 END) as con_curso_null
FROM public.aspirantes
WHERE tenant_id = 'esbas-24';

-- 2. TRANSACCIÓN DE ACTUALIZACIÓN
BEGIN;

UPDATE public.aspirantes
SET curso_id = 1,
    updated_at = now()
WHERE tenant_id = 'esbas-24'
  AND curso_id IS NULL;

COMMIT;

-- 3. CONSULTA POSTERIOR: Confirmar la asignación correcta
SELECT 
    COUNT(*) as total_aspirantes_tenant,
    SUM(CASE WHEN curso_id = 1 THEN 1 ELSE 0 END) as con_curso_1,
    SUM(CASE WHEN curso_id IS NULL THEN 1 ELSE 0 END) as con_curso_null
FROM public.aspirantes
WHERE tenant_id = 'esbas-24';

-- =====================================================================
-- SCRIPT DE BASE DE DATOS: SELECT PÚBLICO DE STAFF_PUSH_TRACKER (HOY)
-- File: sql/027_staff_push_tracker_public_select_hoy.sql
-- =====================================================================
-- El staff que marca asistencia vía QR navega como anon (sin JWT de
-- Supabase Auth). sql/020 solo dejó SELECT a 'authenticated' con perfil
-- en profiles.tenant_id, así que el botón "Ver resumen de hoy" (anon)
-- no podía leer staff_push_tracker. Esta policy agrega SELECT a 'anon',
-- acotado a fecha_jornada = hoy (America/Lima) para no exponer el
-- historial completo del tracker a un cliente sin autenticar.

BEGIN;

DROP POLICY IF EXISTS staff_push_tracker_public_select_hoy ON public.staff_push_tracker;
CREATE POLICY staff_push_tracker_public_select_hoy
    ON public.staff_push_tracker
    FOR SELECT
    TO anon
    USING (fecha_jornada = (now() AT TIME ZONE 'America/Lima')::date);

COMMIT;

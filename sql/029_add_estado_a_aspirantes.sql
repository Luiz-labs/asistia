-- =====================================================================
-- SCRIPT DE BASE DE DATOS: ESTADO ACTIVO/RETIRADO EN ASPIRANTES
-- File: sql/029_add_estado_a_aspirantes.sql
-- =====================================================================
-- Motivo: dar de baja a un aspirante ("Retirar Aspirante"/"Aspirantes
-- Retirados" en Configuración) escribía sobre asistencias.estado, un
-- campo que describe el estado de UNA marcación puntual, no el ciclo
-- de vida del aspirante en el padrón. retirarAspirante()/reactivar()
-- hacían UPDATE asistencias SET estado=... WHERE dni=? sin filtro de
-- fecha/curso, sobrescribiendo el historial real de asistencia de ese
-- DNI en vez de marcar una baja aislada. Confirmado en Supabase: 0
-- filas con estado='retirado' en producción (la feature nunca se usó
-- con un aspirante real), así que no hace falta migrar datos.
--
-- Columna de texto (no booleano) para seguir el patrón ya usado por
-- instituciones_luiz.estado ('activo'/'inactivo'), la entidad
-- administrativa más cercana en el dominio, y para conservar el
-- vocabulario "retirado" ya establecido en la UI y en actividad_logs.

BEGIN;

ALTER TABLE public.aspirantes
    ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activo';

ALTER TABLE public.aspirantes
    ADD CONSTRAINT aspirantes_estado_check CHECK (estado IN ('activo', 'retirado'));

COMMIT;

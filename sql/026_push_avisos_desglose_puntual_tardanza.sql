-- =====================================================================
-- SCRIPT DE BASE DE DATOS: DESGLOSE PUNTUAL/TARDANZA POR CORTE
-- File: sql/026_push_avisos_desglose_puntual_tardanza.sql
-- =====================================================================
-- Complemento a sql/025 (modelo de 3 avisos fijos). El diseño de mensaje
-- acordado para el Aviso 2 reutiliza, sin recalcular, la línea del Corte 1
-- que ya se envió en el Aviso 1. Eso requiere persistir el desglose
-- Puntual/Tardanza en el momento exacto de la captura de cada corte, no
-- solo el total (corteN_presentes, que ya existe desde sql/025).
--
-- Sin esto, reconstruir el desglose más tarde (al armar el Aviso 2 o el
-- Aviso 3) daría números distintos a los ya enviados: una consulta en vivo
-- sumaría marcas nuevas ocurridas después de la captura original, y un
-- filtro por hora-de-corte tampoco calzaría exacto porque la captura real
-- ocurre en el momento en que corre el tick del cron (cada 5 min), no
-- exactamente en corteN_en.
--
-- Tardanza no necesita columna propia: se deriva como
-- (corteN_presentes - corteN_puntual) al armar el texto del aviso.

BEGIN;

ALTER TABLE public.staff_push_tracker
    ADD COLUMN IF NOT EXISTS corte1_puntual INT NULL,
    ADD COLUMN IF NOT EXISTS corte2_puntual INT NULL,
    ADD COLUMN IF NOT EXISTS corte3_puntual INT NULL;

COMMENT ON COLUMN public.staff_push_tracker.corte1_puntual IS
    'sql/026: aspirantes marcados a tiempo (hora <= jornada_inicio_at) en el momento de la captura de corte1. Tardanza = corte1_presentes - corte1_puntual.';
COMMENT ON COLUMN public.staff_push_tracker.corte2_puntual IS
    'sql/026: ver corte1_puntual, mismo criterio aplicado a la captura de corte2.';
COMMENT ON COLUMN public.staff_push_tracker.corte3_puntual IS
    'sql/026: ver corte1_puntual, mismo criterio aplicado a la captura de corte3 (usado por el Aviso 3 solo si en el futuro se decide mostrar desglose ahí; hoy el Aviso 3 no lo muestra, ver process-auto-push/index.ts).';

COMMIT;

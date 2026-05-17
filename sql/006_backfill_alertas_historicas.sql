-- Migration: Backfill Histórico Controlado de Alertas de Marcación en AsistIA
-- File: sql/006_backfill_alertas_historicas.sql
--
-- Descripción:
-- Identifica de forma retrospectiva todas las asistencias registradas en las que 
-- un dispositivo (device_id) fue compartido con otro DNI diferente en el mismo 
-- tenant y curso, ordenado cronológicamente. Genera e inserta registros formales 
-- en la tabla asistencia_alertas con tipo = 'dni_en_otro_dispositivo'.
-- Limita la inyección a máximo una alerta por día/dispositivo/DNI para evitar duplicidad.
-- Solo inserta si la alerta no existe en la tabla de destino.

BEGIN;

-- 1. Inserción controlada
INSERT INTO public.asistencia_alertas (
  tenant_id,
  curso_id,
  fecha,
  hora,
  dni,
  nombre,
  ubo,
  seccion,
  tipo,
  detalle,
  device_id
)
SELECT 
  src.tenant_id,
  src.curso_id,
  src.fecha,
  src.hora,
  src.dni,
  src.nombre,
  src.ubo,
  src.seccion,
  src.tipo,
  src.detalle,
  src.device_id
FROM (
  WITH asistencias_ordenadas AS (
    SELECT 
      tenant_id,
      curso_id,
      fecha,
      hora,
      dni,
      nombre,
      ubo,
      seccion,
      device_id,
      -- Consolidamos la lista de todos los DNIs distintos que usaron este dispositivo ANTES del registro actual
      (
        SELECT array_agg(DISTINCT b.dni)
        FROM public.asistencias b
        WHERE b.tenant_id = a.tenant_id
          AND b.curso_id = a.curso_id
          AND b.device_id = a.device_id
          AND (b.fecha < a.fecha OR (b.fecha = a.fecha AND b.hora < a.hora))
      ) AS dnis_previos
    FROM public.asistencias a
    WHERE device_id IS NOT NULL AND device_id <> ''
  ),
  asistencias_con_alerta AS (
    SELECT *,
           row_number() OVER (PARTITION BY tenant_id, curso_id, device_id, dni, fecha ORDER BY hora ASC) AS rn
    FROM asistencias_ordenadas
    -- Filtramos para que existan DNIs previos en el dispositivo y que el DNI actual sea diferente (no registrado en la lista previa)
    WHERE dnis_previos IS NOT NULL 
      AND cardinality(dnis_previos) > 0
      AND NOT (dni = ANY(dnis_previos))
  )
  SELECT 
    tenant_id,
    curso_id,
    fecha,
    hora,
    dni,
    nombre,
    ubo,
    seccion,
    device_id,
    'dni_en_otro_dispositivo' AS tipo,
    'El dispositivo ya ha sido utilizado por otro DNI en este curso (DNI actual: ' || dni || ').' AS detalle
  FROM asistencias_con_alerta
  WHERE rn = 1
) src
WHERE NOT EXISTS (
  SELECT 1
  FROM public.asistencia_alertas dest
  WHERE dest.tenant_id = src.tenant_id
    AND dest.curso_id = src.curso_id
    AND dest.dni = src.dni
    AND dest.device_id = src.device_id
    AND dest.tipo = src.tipo
    AND dest.fecha = src.fecha
);

COMMIT;

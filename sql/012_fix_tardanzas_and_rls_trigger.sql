-- =====================================================================
-- SCRIPT DE BASE DE DATOS COMPLETO Y SEGURO (Ejecutar en Supabase SQL Editor)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. CORRECCIÓN DEL TRIGGER DE SINCRONIZACIÓN (SECURITY DEFINER + RLS Bypass)
-- ---------------------------------------------------------------------

-- Redefinir la función del trigger para que corra como superusuario (SECURITY DEFINER)
-- y con search_path seguro para evitar escalamiento de privilegios.
CREATE OR REPLACE FUNCTION public.fn_sincronizar_seccion_a_jornada_reglas()
RETURNS TRIGGER AS $$
DECLARE
    v_jornada_id public.curso_jornadas.id%TYPE;
    v_dias_ints integer[];
    v_target_tenant text;
    v_target_curso bigint;
    v_target_seccion text;
BEGIN
    v_target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
    v_target_curso := COALESCE(NEW.curso_id, OLD.curso_id);
    v_target_seccion := COALESCE(NEW.seccion, OLD.seccion);

    -- Convertir días a enteros si no es un DELETE
    IF TG_OP <> 'DELETE' THEN
        v_dias_ints := public.fn_seccion_dias_a_ints(NEW.dias);
        
        -- Resolver o crear jornada en curso_jornadas
        SELECT id INTO v_jornada_id
        FROM public.curso_jornadas
        WHERE tenant_id = v_target_tenant
          AND codigo = 'SECCION_REGULAR'
        LIMIT 1;

        IF v_jornada_id IS NULL THEN
            INSERT INTO public.curso_jornadas (tenant_id, codigo, nombre_visible, activa)
            VALUES (v_target_tenant, 'SECCION_REGULAR', 'Regular de sección', true)
            RETURNING id INTO v_jornada_id;
        END IF;
    END IF;

    -- Procesar DELETE Lógico en las reglas
    IF TG_OP = 'DELETE' THEN
        UPDATE public.curso_jornada_reglas
        SET activa = false
        WHERE tenant_id = v_target_tenant
          AND curso_id = v_target_curso
          AND seccion = v_target_seccion;
        RETURN OLD;
        
    -- Procesar INSERT / UPDATE
    ELSE
        -- Si la regla ya existe, actualizarla preservando configuraciones del administrador
        IF EXISTS (
            SELECT 1 FROM public.curso_jornada_reglas
            WHERE tenant_id = v_target_tenant
              AND curso_id = v_target_curso
              AND seccion = v_target_seccion
        ) THEN
            UPDATE public.curso_jornada_reglas
            SET modalidad = upper(trim(NEW.modalidad)),
                hora_inicio = NEW.hora_inicio,
                dias_semana = v_dias_ints,
                activa = true,
                jornada_id = v_jornada_id
            WHERE tenant_id = v_target_tenant
              AND curso_id = v_target_curso
              AND seccion = v_target_seccion;
        ELSE
            -- Si es una regla nueva, insertarla con los valores por defecto requeridos
            INSERT INTO public.curso_jornada_reglas (
                tenant_id,
                curso_id,
                seccion,
                modalidad,
                hora_inicio,
                dias_semana,
                activa,
                jornada_id,
                prioridad_resolucion,
                tolerancia_tardanza_min,
                permitir_registro_fuera_horario,
                requiere_gps
            ) VALUES (
                NEW.tenant_id,
                NEW.curso_id,
                NEW.seccion,
                upper(trim(NEW.modalidad)),
                NEW.hora_inicio,
                v_dias_ints,
                true,
                v_jornada_id,
                10,   -- prioridad_resolucion default
                15,   -- tolerancia_tardanza_min default
                true,  -- permitir_registro_fuera_horario default
                false -- requiere_gps default
            );
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-vincular el trigger de sincronización (los demás triggers como trg_audit_curso_secciones quedan intactos)
DROP TRIGGER IF EXISTS trg_sync_curso_secciones_to_reglas ON public.curso_secciones;

CREATE TRIGGER trg_sync_curso_secciones_to_reglas
AFTER INSERT OR UPDATE OR DELETE
ON public.curso_secciones
FOR EACH ROW
EXECUTE FUNCTION public.fn_sincronizar_seccion_a_jornada_reglas();


-- ---------------------------------------------------------------------
-- 2. RE-CREACIÓN DE LA FUNCIÓN DE CÁLCULO DE TARDANZAS / HORARIOS
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_resolver_contexto_asistencia(
  p_qr_token text,
  p_dni text,
  p_timestamp timestamptz default now(),
  p_device_id text default null,
  p_latitud numeric default null,
  p_longitud numeric default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr_token text := nullif(trim(coalesce(p_qr_token, '')), '');
  v_dni text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
  v_ts timestamptz := coalesce(p_timestamp, now());

  v_lima_ts timestamp;
  v_fecha_lima date;
  v_hora_lima time;
  v_dow smallint;

  v_curso_id bigint;
  v_tenant_id text;
  v_curso_estado text;

  v_nombres text;
  v_apellidos text;
  v_nombre_completo text;
  v_ubo text;
  v_seccion text;
  v_asp_curso_id bigint;

  v_regla_id uuid;
  v_jornada_codigo text;
  v_jornada_label text;
  v_modalidad text;
  v_modalidad_label text;
  v_hora_inicio time;
  v_tolerancia_tardanza_min integer;
  v_permitir_fuera_horario boolean;
  v_requiere_gps boolean;
  v_origen_contexto text := 'fn_resolver_contexto_asistencia';

  v_estado_asistencia text;
  v_permitido boolean := false;
  v_code text := 'error_interno';
  v_message text := 'No se pudo resolver el contexto de asistencia.';

  v_rank_fecha int;
  v_rank_spec int;
  v_prioridad int;

  v_second_rank_fecha int;
  v_second_rank_spec int;
  v_second_prioridad int;
  v_second_hora_inicio time;

  v_warnings jsonb := '[]'::jsonb;
  v_bloqueos jsonb := '[]'::jsonb;
BEGIN
  v_lima_ts := timezone('America/Lima', v_ts);
  v_fecha_lima := v_lima_ts::date;
  v_hora_lima := v_lima_ts::time;
  v_dow := extract(dow from v_lima_ts)::smallint;

  IF v_qr_token IS NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'qr_invalido',
      'message', 'Acceso no válido. Escanee el código QR oficial del curso.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'qr_invalido', 'message', 'Acceso no válido. Escanee el código QR oficial del curso.'))
    );
  END IF;

  IF length(v_dni) <> 8 THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'dni_invalido',
      'message', 'DNI no válido.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'dni_invalido', 'message', 'DNI no válido.'))
    );
  END IF;

  SELECT c.id, c.tenant_id, c.estado INTO v_curso_id, v_tenant_id, v_curso_estado
  FROM public.cursos c WHERE c.qr_token = v_qr_token LIMIT 1;

  IF v_curso_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'qr_invalido',
      'message', 'Acceso no válido. Escanee el código QR oficial del curso.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'qr_invalido', 'message', 'Acceso no válido. Escanee el código QR oficial del curso.'))
    );
  END IF;

  IF COALESCE(v_curso_estado, '') <> 'activo' THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'curso_inactivo',
      'message', 'El curso asociado al QR no está activo.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'curso_inactivo', 'message', 'El curso asociado al QR no está activo.'))
    );
  END IF;

  SELECT a.nombres, a.apellidos, a.ubo, upper(trim(coalesce(a.seccion, ''))), a.curso_id
  INTO v_nombres, v_apellidos, v_ubo, v_seccion, v_asp_curso_id
  FROM public.aspirantes a WHERE a.tenant_id = v_tenant_id AND a.dni = v_dni LIMIT 1;

  IF v_nombres IS NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'dni_no_encontrado',
      'message', 'El DNI ingresado no existe en el padrón de la institución.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'dni_no_encontrado', 'message', 'El DNI ingresado no existe en el padrón de la institución.'))
    );
  END IF;

  IF v_asp_curso_id IS NOT NULL AND v_asp_curso_id <> v_curso_id THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'aspirante_fuera_de_curso',
      'message', 'El aspirante no pertenece al curso de este QR.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'aspirante_fuera_de_curso', 'message', 'El aspirante no pertenece al curso de este QR.'))
    );
  END IF;

  IF COALESCE(v_seccion, '') = '' OR v_seccion IN ('GENERAL', 'DOMINICAL') THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'aspirante_sin_seccion',
      'message', 'El aspirante no tiene sección asignada. Contacte al administrador.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'aspirante_sin_seccion', 'message', 'El aspirante no tiene sección asignada. Contacte al administrador.'))
    );
  END IF;

  WITH candidatas AS (
    SELECT
      r.id as regla_id,
      j.codigo as jornada_codigo,
      j.nombre_visible as jornada_label,
      r.modalidad,
      CASE r.modalidad WHEN 'PRESENCIAL' THEN 'Presencial' WHEN 'VIRTUAL' THEN 'Virtual' ELSE r.modalidad END as modalidad_label,
      r.hora_inicio,
      r.tolerancia_tardanza_min,
      r.permitir_registro_fuera_horario,
      r.requiere_gps,
      r.prioridad_resolucion as prioridad,
      CASE WHEN r.fecha_especifica = v_fecha_lima THEN 0 ELSE 1 END as rank_fecha,
      CASE WHEN r.seccion = v_seccion THEN 0 ELSE 1 END as rank_spec
    FROM public.curso_jornada_reglas r
    JOIN public.curso_jornadas j ON j.id = r.jornada_id
    WHERE r.tenant_id = v_tenant_id AND r.curso_id = v_curso_id AND r.activa = true AND j.activa = true
      AND (r.fecha_especifica = v_fecha_lima OR (r.fecha_especifica IS NULL AND (r.vigente_desde IS NULL OR v_fecha_lima >= r.vigente_desde) AND (r.vigente_hasta IS NULL OR v_fecha_lima <= r.vigente_hasta) AND r.dias_semana IS NOT NULL AND v_dow = ANY(r.dias_semana)))
      AND (r.seccion = v_seccion OR r.seccion IS NULL)
  ),
  ranked AS (
    SELECT c.*, row_number() over (order by c.rank_fecha asc, c.prioridad asc, c.rank_spec asc, c.hora_inicio asc, c.regla_id asc) as rn
    FROM candidatas c
  )
  SELECT
    r.regla_id, r.jornada_codigo, r.jornada_label, r.modalidad, r.modalidad_label, r.hora_inicio, r.tolerancia_tardanza_min, r.permitir_registro_fuera_horario, r.requiere_gps, r.rank_fecha, r.rank_spec, r.prioridad, s.rank_fecha, s.rank_spec, s.prioridad, s.hora_inicio
  INTO
    v_regla_id, v_jornada_codigo, v_jornada_label, v_modalidad, v_modalidad_label, v_hora_inicio, v_tolerancia_tardanza_min, v_permitir_fuera_horario, v_requiere_gps, v_rank_fecha, v_rank_spec, v_prioridad, v_second_rank_fecha, v_second_rank_spec, v_second_prioridad, v_second_hora_inicio
  FROM ranked r LEFT JOIN ranked s ON s.rn = 2 WHERE r.rn = 1;

  IF v_regla_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'sin_jornada_programada',
      'message', 'No hay una jornada programada para este aspirante en este momento.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'sin_jornada_programada', 'message', 'No hay una jornada programada para este aspirante en este momento.'))
    );
  END IF;

  IF v_second_prioridad IS NOT NULL AND v_second_rank_fecha = v_rank_fecha AND v_second_rank_spec = v_rank_spec AND v_second_prioridad = v_prioridad AND v_second_hora_inicio = v_hora_inicio THEN
    RETURN jsonb_build_object(
      'success', true, 'permitido', false, 'code', 'configuracion_ambigua',
      'message', 'La configuración del curso es ambigua para esta fecha y sección.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'configuracion_ambigua', 'message', 'La configuración del curso es ambigua para esta fecha y sección.'))
    );
  END IF;

  -- ---------------------------------------------------------------------
  -- NUEVA LÓGICA DE TIEMPOS (Tolerancia como PUNTUAL)
  -- ---------------------------------------------------------------------
  IF v_hora_lima < v_hora_inicio THEN
    v_estado_asistencia := 'FUERA_DE_HORARIO';
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object('code', 'anticipado', 'message', 'Registro anticipado fuera de horario.')
    );
  ELSIF v_hora_lima <= (v_hora_inicio + make_interval(mins => COALESCE(v_tolerancia_tardanza_min, 15)))::time THEN
    v_estado_asistencia := 'PUNTUAL';
  ELSE
    IF COALESCE(v_permitir_fuera_horario, false) THEN
      v_estado_asistencia := 'TARDANZA';
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object('code', 'tardanza', 'message', 'Registro en tardanza.')
      );
    ELSE
      v_estado_asistencia := 'FUERA_DE_HORARIO';
      v_bloqueos := v_bloqueos || jsonb_build_array(
        jsonb_build_object('code', 'fuera_de_horario', 'message', 'La jornada no permite registros fuera de horario.')
      );
    END IF;
  END IF;

  IF v_estado_asistencia = 'FUERA_DE_HORARIO' AND NOT COALESCE(v_permitir_fuera_horario, false) THEN
    v_permitido := false;
    v_code := 'fuera_de_horario';
    v_message := 'La jornada no permite registros fuera de horario.';
  ELSE
    v_permitido := true;
    v_code := 'ok';
    v_message := 'Contexto resuelto correctamente.';
  END IF;

  IF COALESCE(v_requiere_gps, false) AND (p_latitud IS NULL OR p_longitud IS NULL) THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'gps_no_disponible', 'message', 'La regla tiene validación GPS preparada, pero no se enviaron coordenadas.'));
  END IF;

  IF nullif(trim(coalesce(p_device_id, '')), '') IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'device_id_ausente', 'message', 'No se recibió identificador de dispositivo.'));
  END IF;

  v_nombre_completo := trim(concat_ws(' ', v_nombres, v_apellidos));

  RETURN jsonb_build_object(
    'success', true,
    'permitido', v_permitido,
    'code', v_code,
    'message', v_message,
    'curso_id', v_curso_id,
    'tenant_id', v_tenant_id,
    'jornada_codigo', v_jornada_codigo,
    'jornada_label', v_jornada_label,
    'modalidad', v_modalidad,
    'modalidad_label', v_modalidad_label,
    'seccion', v_seccion,
    'estado_asistencia', v_estado_asistencia,
    'hora_inicio', to_char(v_hora_inicio, 'HH24:MI'),
    'regla_jornada_id', v_regla_id,
    'origen_contexto', v_origen_contexto,
    'warnings', COALESCE(v_warnings, '[]'::jsonb),
    'bloqueos', COALESCE(v_bloqueos, '[]'::jsonb),
    'aspirante', jsonb_build_object('dni', v_dni, 'nombres', v_nombres, 'apellidos', v_apellidos, 'ubo', v_ubo, 'nombre', v_nombre_completo)
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false, 'permitido', false, 'code', 'error_interno', 'message', 'No se pudo resolver el contexto de asistencia.',
      'bloqueos', jsonb_build_array(jsonb_build_object('code', 'error_interno', 'message', SQLERRM))
    );
END;
$$;


-- ---------------------------------------------------------------------
-- 3. CONSULTA DE PRUEBA Y VALIDACIÓN DE TARDANZA (Dry Run)
-- ---------------------------------------------------------------------
SELECT public.fn_resolver_contexto_asistencia(
    'asistia_esbas24_2026_x8-k29s7p',
    '40636507',
    '2026-07-08 16:30:00-05'::timestamptz
) AS prueba_tardanza;

COMMIT;

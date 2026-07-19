-- Migration: Parche Mínimo TODOS_ASPIRANTES en Justificaciones
-- File: sql/018_allow_todos_aspirantes_justificaciones.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_validar_fecha_justificable(
    p_tenant_id TEXT,
    p_curso_id BIGINT,
    p_dni TEXT,
    p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_seccion TEXT;
    v_has_asistencia BOOLEAN := FALSE;
    v_asistencia_estado TEXT;
    v_ctx jsonb;
    v_timestamp TIMESTAMPTZ;
    v_qr_token TEXT;
    -- Variables para el parche TODOS_ASPIRANTES
    v_clase_activa BOOLEAN;
    v_label_clase TEXT;
BEGIN
    -- 1. Verificar si el aspirante existe y obtener su sección
    SELECT upper(trim(coalesce(seccion, '')))
      INTO v_seccion
    FROM public.aspirantes
    WHERE tenant_id = p_tenant_id
      AND curso_id = p_curso_id
      AND dni = p_dni
    LIMIT 1;

    IF v_seccion IS NULL THEN
        RETURN jsonb_build_object(
            'justificable', false,
            'reason', 'El DNI ingresado no pertenece a un aspirante activo.'
        );
    END IF;

    -- 2. Buscar si existe asistencia registrada en esa fecha
    SELECT true, estado_asistencia
      INTO v_has_asistencia, v_asistencia_estado
    FROM public.asistencias
    WHERE tenant_id = p_tenant_id
      AND curso_id = p_curso_id
      AND dni = p_dni
      AND fecha = p_fecha
    LIMIT 1;

    IF v_has_asistencia THEN
        -- Si existe asistencia, solo es justificable si tiene Tardanza o Fuera de Horario
        IF v_asistencia_estado IN ('TARDANZA', 'FUERA_DE_HORARIO') THEN
            RETURN jsonb_build_object(
                'justificable', true,
                'condition', v_asistencia_estado,
                'reason', 'Marcación existente en condición de ' || v_asistencia_estado || '.'
            );
        ELSE
            RETURN jsonb_build_object(
                'justificable', false,
                'reason', 'El aspirante ya cuenta con una asistencia PUNTUAL registrada en la fecha indicada.'
            );
        END IF;
    END IF;

    -- 3. Si no existe asistencia, obtener el qr_token del curso
    SELECT qr_token INTO v_qr_token
    FROM public.cursos
    WHERE tenant_id = p_tenant_id
      AND id = p_curso_id
    LIMIT 1;

    IF v_qr_token IS NULL THEN
        RETURN jsonb_build_object(
            'justificable', false,
            'reason', 'No se pudo resolver el token QR del curso.'
        );
    END IF;

    -- 4. Verificar si había clase programada (Falta / Sin Marcación)
    v_timestamp := (p_fecha::text || ' 12:00:00-05')::timestamptz;
    v_ctx := public.fn_resolver_contexto_asistencia(
        v_qr_token,
        p_dni,
        v_timestamp
    );

    IF coalesce((v_ctx->>'success')::boolean, false) AND v_ctx->>'regla_jornada_id' IS NOT NULL THEN
        RETURN jsonb_build_object(
            'justificable', true,
            'condition', 'FALTA',
            'origen_contexto', v_ctx->>'origen_contexto',
            'jornada_label', v_ctx->>'jornada_label',
            'reason', 'Sin marcación en jornada de clase programada (' || (v_ctx->>'jornada_label') || ').'
        );
    ELSE
        -- ALTERNATIVA CONTROLADA: Validar programación global TODOS_ASPIRANTES activa
        SELECT hay_clase, COALESCE(nota, 'Sesión especial para todos los aspirantes')
          INTO v_clase_activa, v_label_clase
        FROM public.calendario_sedes_gps
        WHERE tenant_id = p_tenant_id
          AND curso_id = p_curso_id
          AND fecha = p_fecha
          AND activo = true
          AND aplica_a = 'TODOS_ASPIRANTES'
          AND hay_clase = true
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'justificable', true,
                'condition', 'FALTA',
                'origen_contexto', 'calendario_todos_aspirantes',
                'jornada_label', v_label_clase,
                'reason', 'Sin marcación en jornada de clase programada (' || v_label_clase || ').'
            );
        ELSE
            RETURN jsonb_build_object(
                'justificable', false,
                'reason', 'No hubo una jornada o actividad programada para la fecha indicada.'
            );
        END IF;
    END IF;
END;
$$;

COMMIT;

-- Rollback: Revertir Parche Mínimo TODOS_ASPIRANTES en Justificaciones
-- File: sql/rollback_018.sql

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
            'reason', 'Sin marcación en jornada de clase programada (' || (v_ctx->>'jornada_label') || ').'
        );
    ELSE
        RETURN jsonb_build_object(
            'justificable', false,
            'reason', 'No había ninguna jornada de clases programada para su sección en la fecha indicada.'
        );
    END IF;
END;
$$;

COMMIT;

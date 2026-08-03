-- =====================================================================
-- SCRIPT DE BASE DE DATOS: CREACIÓN DE TABLA DE SUSCRIPCIONES PUSH Y RPC
-- (Ejecutar en Supabase SQL Editor)
-- =====================================================================

BEGIN;

-- 1. Crear tabla de suscripciones
CREATE TABLE IF NOT EXISTS public.staff_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    staff_id UUID NOT NULL REFERENCES public.staff_instruccion (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Crear índices únicos
CREATE UNIQUE INDEX IF NOT EXISTS staff_push_sub_device_idx 
    ON public.staff_push_subscriptions (tenant_id, staff_id, device_id);

CREATE UNIQUE INDEX IF NOT EXISTS staff_push_sub_endpoint_idx 
    ON public.staff_push_subscriptions (endpoint);

-- 3. Habilitar RLS
ALTER TABLE public.staff_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 4. Crear política RLS para administradores
DROP POLICY IF EXISTS staff_push_subs_admin_policy ON public.staff_push_subscriptions;
CREATE POLICY staff_push_subs_admin_policy ON public.staff_push_subscriptions
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.tenant_id = staff_push_subscriptions.tenant_id
        )
    );

-- 5. Crear la RPC de registro determinista
CREATE OR REPLACE FUNCTION public.rpc_registrar_suscripcion_push(
    p_tenant_id TEXT,
    p_staff_id UUID,
    p_device_id TEXT,
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_staff_valido BOOLEAN;
    v_sub_id UUID;
BEGIN
    -- A. Validar que el Staff existe y está activo en este tenant
    SELECT exists (
        SELECT 1 FROM public.staff_instruccion
        WHERE id = p_staff_id AND tenant_id = p_tenant_id AND activo = true
    ) INTO v_staff_valido;

    IF NOT v_staff_valido THEN
        RETURN jsonb_build_object('success', false, 'error', 'Staff inactivo o no pertenece a la institución.');
    END IF;

    -- B. Buscar si ya existe una suscripción por el mismo endpoint exacto
    SELECT id INTO v_sub_id
    from public.staff_push_subscriptions
    WHERE endpoint = p_endpoint;

    IF v_sub_id IS NOT NULL THEN
        -- Actualizar datos de la suscripción existente por endpoint
        UPDATE public.staff_push_subscriptions
        SET tenant_id = p_tenant_id,
            staff_id = p_staff_id,
            device_id = p_device_id,
            p256dh = p_p256dh,
            auth = p_auth,
            estado = 'activo',
            updated_at = now()
        WHERE id = v_sub_id;
    ELSE
        -- C. Si no existe por endpoint, buscar por la combinación única (tenant_id, staff_id, device_id)
        SELECT id INTO v_sub_id
        from public.staff_push_subscriptions
        WHERE tenant_id = p_tenant_id 
          AND staff_id = p_staff_id 
          AND device_id = p_device_id;

        IF v_sub_id IS NOT NULL THEN
            -- Actualizar el endpoint y llaves para este dispositivo
            UPDATE public.staff_push_subscriptions
            SET endpoint = p_endpoint,
                p256dh = p_p256dh,
                auth = p_auth,
                estado = 'activo',
                updated_at = now()
            WHERE id = v_sub_id;
        ELSE
            -- D. Si no existe ningún registro previo, hacer INSERT
            INSERT INTO public.staff_push_subscriptions (
                tenant_id, staff_id, device_id, endpoint, p256dh, auth, estado, updated_at
            ) VALUES (
                p_tenant_id, p_staff_id, p_device_id, p_endpoint, p_p256dh, p_auth, 'activo', now()
            )
            RETURNING id INTO v_sub_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_sub_id);
END;
$$;

COMMIT;

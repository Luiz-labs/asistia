-- =====================================================================
-- SCRIPT DE BASE DE DATOS: SUSCRIPCIONES PUSH PARA USUARIOS DE BACKOFFICE
-- File: sql/023_create_backoffice_push_subscriptions.sql
-- =====================================================================
-- NOTA: usuarios_admin.rol almacena 'administrador' o 'super_admin'
-- (ver rolUsuarioSupabaseDesdeApp en app.js) -- NO 'superusuario'.
-- El perfil personalizado "Staff" es un sub-nivel de permisos dentro de
-- rol = 'administrador' (tabla perfiles_luiz), no un valor distinto de
-- esta columna, por lo que no requiere tratamiento aparte aquí.

BEGIN;

-- 1. Crear tabla de suscripciones push para usuarios de backoffice
--    (Superusuario, Administrador y perfil "Staff")
CREATE TABLE IF NOT EXISTS public.backoffice_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_admin_id BIGINT NOT NULL REFERENCES public.usuarios_admin (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Índices únicos (mismo patrón que staff_push_subscriptions, sql/019)
CREATE UNIQUE INDEX IF NOT EXISTS backoffice_push_sub_device_idx
    ON public.backoffice_push_subscriptions (usuario_admin_id, device_id);

CREATE UNIQUE INDEX IF NOT EXISTS backoffice_push_sub_endpoint_idx
    ON public.backoffice_push_subscriptions (endpoint);

-- 3. Habilitar RLS
ALTER TABLE public.backoffice_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 4. Política RLS: solo el dueño exacto de la suscripción (comparación
--    directa contra usuarios_admin.auth_user_id, NO por tenant_id -- un
--    JOIN por tenant_id expondría las suscripciones de otros admins de la
--    misma institución). La Edge Function usa SERVICE_ROLE_KEY y el RPC de
--    registro es SECURITY DEFINER, así que ninguno de los dos depende de
--    esta política -- es una red de seguridad para consultas directas
--    desde un cliente autenticado.
-- Tipos verificados contra information_schema.columns en la BD real
-- (usuarios_admin.id = bigint, usuarios_admin.auth_user_id = uuid).
DROP POLICY IF EXISTS backoffice_push_subs_admin_policy ON public.backoffice_push_subscriptions;
CREATE POLICY backoffice_push_subs_admin_policy ON public.backoffice_push_subscriptions
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.usuarios_admin ua
            WHERE ua.id = backoffice_push_subscriptions.usuario_admin_id
              AND ua.auth_user_id = auth.uid()
        )
    );

-- 5. RPC de registro determinista (SECURITY DEFINER).
--    El login de backoffice usa la tabla usuarios_admin con clave propia
--    (auth_user_id es opcional/nullable), igual que staff_instruccion no
--    usa Supabase Auth -- por eso este RPC no depende de auth.uid().
CREATE OR REPLACE FUNCTION public.rpc_registrar_suscripcion_push_backoffice(
    p_usuario_admin_id BIGINT,
    p_device_id TEXT,
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_valido BOOLEAN;
    v_sub_id UUID;
BEGIN
    -- A. Validar que el usuario de backoffice existe, está activo y su rol
    --    habilita notificaciones (administrador o super_admin).
    SELECT EXISTS (
        SELECT 1 FROM public.usuarios_admin
        WHERE id = p_usuario_admin_id
          AND activo = true
          AND rol IN ('administrador', 'super_admin')
    ) INTO v_usuario_valido;

    IF NOT v_usuario_valido THEN
        RETURN jsonb_build_object('success', false, 'error', 'Usuario inactivo o sin rol habilitado para notificaciones.');
    END IF;

    -- B. Buscar si ya existe una suscripción por el mismo endpoint exacto
    SELECT id INTO v_sub_id
    FROM public.backoffice_push_subscriptions
    WHERE endpoint = p_endpoint;

    IF v_sub_id IS NOT NULL THEN
        -- Actualizar datos de la suscripción existente por endpoint
        UPDATE public.backoffice_push_subscriptions
        SET usuario_admin_id = p_usuario_admin_id,
            device_id = p_device_id,
            p256dh = p_p256dh,
            auth = p_auth,
            estado = 'activo',
            updated_at = now()
        WHERE id = v_sub_id;
    ELSE
        -- C. Si no existe por endpoint, buscar por la combinación única
        --    (usuario_admin_id, device_id)
        SELECT id INTO v_sub_id
        FROM public.backoffice_push_subscriptions
        WHERE usuario_admin_id = p_usuario_admin_id
          AND device_id = p_device_id;

        IF v_sub_id IS NOT NULL THEN
            -- Actualizar el endpoint y llaves para este dispositivo
            UPDATE public.backoffice_push_subscriptions
            SET endpoint = p_endpoint,
                p256dh = p_p256dh,
                auth = p_auth,
                estado = 'activo',
                updated_at = now()
            WHERE id = v_sub_id;
        ELSE
            -- D. Si no existe ningún registro previo, hacer INSERT
            INSERT INTO public.backoffice_push_subscriptions (
                usuario_admin_id, device_id, endpoint, p256dh, auth, estado, updated_at
            ) VALUES (
                p_usuario_admin_id, p_device_id, p_endpoint, p_p256dh, p_auth, 'activo', now()
            )
            RETURNING id INTO v_sub_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_sub_id);
END;
$$;

-- 6. Feature flag por institución: el motor de push (process-auto-push)
--    debe saltar por completo (sin queries pesadas ni envío) cualquier
--    institución con push_habilitado = false. Queda en FALSE por defecto
--    para TODAS las instituciones existentes (incluyendo esbas-24 y
--    esbas-24-demo) -- se activa manualmente institución por institución
--    desde el Table Editor de Supabase.
ALTER TABLE public.instituciones_luiz
    ADD COLUMN IF NOT EXISTS push_habilitado BOOLEAN NOT NULL DEFAULT false;

COMMIT;

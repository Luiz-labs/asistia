-- =====================================================================
-- SCRIPT DE BASE DE DATOS: RPC PARA RESOLVER usuarios_admin.id POR usuario
-- File: sql/024_create_rpc_resolver_usuario_admin_id.sql
-- =====================================================================
-- Motivo: registrarSuscripcionPushBackoffice() (frontend) necesitaba el id
-- (bigint) del admin activo a partir de su "usuario" para poder llamar a
-- rpc_registrar_suscripcion_push_backoffice (sql/023). Hacerlo con un
-- SELECT directo a usuarios_admin dependía de que el cliente Supabase
-- tuviera una sesión autenticada a nivel Postgres (rol "authenticated") --
-- pero el login del Superusuario por defecto (dominio raíz, origen
-- "staff_root") resuelve la sesión vía el RPC resolver_login_admin SIN
-- llamar nunca a signInWithPassword, por lo que el cliente sigue operando
-- como "anon". Tras revocar los privilegios de "anon" sobre usuarios_admin
-- (corrección de seguridad aplicada hoy), ese SELECT directo habría fallado
-- con 401 para el Superusuario legítimamente logueado.
--
-- Este RPC replica exactamente el patrón de resolver_login_admin: SECURITY
-- DEFINER, no depende de auth.uid() ni de si el cliente está autenticado a
-- nivel Postgres -- solo valida el estado real de la fila en usuarios_admin.
-- No expone "clave" ni ninguna otra columna sensible, solo el id.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_resolver_usuario_admin_id_por_usuario(
    p_usuario TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id
    FROM public.usuarios_admin
    WHERE lower(trim(usuario)) = lower(trim(coalesce(p_usuario, '')))
      AND activo = true
      AND rol IN ('administrador', 'super_admin')
    LIMIT 1;

    RETURN v_id;
END;
$$;

COMMIT;

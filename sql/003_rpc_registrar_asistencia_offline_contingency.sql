-- FASE 1.1: soporte de contingencia offline para aspirantes
-- Este script NO se ejecuta automáticamente desde el repo.
-- Revísalo y aplícalo manualmente en Supabase SQL Editor cuando corresponda.
--
-- Objetivo:
-- 1. Permitir que la RPC reciba p_origen_registro.
-- 2. Persistir origen_registro = 'offline' cuando la asistencia nació offline.
-- 3. Usar p_timestamp_local como hora/fecha original del registro cuando venga informado.
--
-- IMPORTANTE:
-- - Este archivo asume que ya existe public.rpc_registrar_asistencia(...)
-- - Si tu función actual tiene lógica adicional de validación/duplicados, CONSÉRVALA.
-- - El cambio clave es de firma + normalización + uso de v_ts/v_fecha/v_hora en el INSERT final.

begin;

alter table public.asistencias
    add column if not exists origen_registro text;

alter table public.asistencias
    add column if not exists timestamp_local timestamptz;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'asistencias_origen_registro_check'
    ) then
        alter table public.asistencias
            add constraint asistencias_origen_registro_check
            check (
                origen_registro is null
                or origen_registro in (
                    'qr',
                    'qr_aspirantes',
                    'qr_publico',
                    'offline',
                    'importacion_historica'
                )
            );
    end if;
end $$;

comment on column public.asistencias.origen_registro is
'Origen del registro: qr_publico, offline, importacion_historica, etc.';

comment on column public.asistencias.timestamp_local is
'Marca temporal original reportada por el dispositivo cliente.';

-- CAMBIO REQUERIDO EN LA RPC EXISTENTE:
--
-- 1) Agrega a la firma:
--    p_origen_registro text default ''qr_publico''
--
-- 2) Dentro de la función, antes del INSERT:
--
--    v_ts timestamptz := coalesce(p_timestamp_local, now());
--    v_lima_ts timestamp := timezone('America/Lima', v_ts);
--    v_fecha date := v_lima_ts::date;
--    v_hora time := v_lima_ts::time;
--    v_origen_registro text := case
--        when lower(coalesce(trim(p_origen_registro), '')) = 'offline' then 'offline'
--        when lower(coalesce(trim(p_origen_registro), '')) in ('qr', 'qr_aspirantes', 'qr_publico') then 'qr_publico'
--        else 'qr_publico'
--    end;
--
-- 3) En el INSERT final a public.asistencias, asegúrate de grabar:
--
--    fecha = v_fecha
--    hora = v_hora
--    timestamp_local = v_ts
--    origen_registro = v_origen_registro
--
-- Ejemplo mínimo del fragmento de INSERT:
--
-- insert into public.asistencias (
--     dni,
--     nombre,
--     ubo,
--     seccion,
--     fecha,
--     hora,
--     tenant_id,
--     estado,
--     curso_id,
--     tipo_jornada,
--     device_id,
--     timestamp_local,
--     origen_registro
-- ) values (
--     v_dni,
--     v_nombre,
--     v_ubo,
--     v_seccion,
--     v_fecha,
--     v_hora,
--     v_tenant_id,
--     'registrado',
--     v_curso_id,
--     v_tipo_jornada,
--     p_device_id,
--     v_ts,
--     v_origen_registro
-- );

commit;

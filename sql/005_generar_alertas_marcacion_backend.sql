-- Migration: Generación formal de Alertas de Marcación en AsistIA Backend
-- File: sql/005_generar_alertas_marcacion_backend.sql
--
-- Descripción:
-- Reemplaza la RPC rpc_registrar_asistencia_v2 para incluir la detección formal de la alerta 
-- 'dni_en_otro_dispositivo' (DNI distinto en el mismo dispositivo) a nivel de base de datos.
-- Persiste la alerta en asistencia_alertas con scopes correctos (tenant_id, curso_id) y
-- retorna un warning limpio al cliente móvil ('Uso de dispositivo no habitual.').
-- Evita duplicación de alertas por el mismo evento en el mismo día.

begin;

create or replace function public.rpc_registrar_asistencia_v2(
  p_qr_token text,
  p_dni text,
  p_timestamp timestamp with time zone default now(),
  p_device_id text default null::text,
  p_latitud numeric default null::numeric,
  p_longitud numeric default null::numeric,
  p_origen_registro text default 'qr_publico'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ctx jsonb;
  v_success boolean;
  v_permitido boolean;
  v_code text;
  v_message text;
  v_tenant_id text;
  v_curso_id bigint;
  v_dni text;
  v_nombre text;
  v_ubo text;
  v_seccion text;
  v_tipo_jornada text;
  v_modalidad text;
  v_estado_asistencia text;
  v_regla_jornada_id uuid;
  v_origen_contexto text;
  v_timestamp_lima timestamp;
  v_fecha_lima date;
  v_hora_lima time;
  v_asistencia_id uuid;
  v_warnings jsonb := '[]'::jsonb;
begin
  -- 1. Resolver contexto localizable
  v_ctx := public.fn_resolver_contexto_asistencia(
    p_qr_token, p_dni, p_timestamp, p_device_id, p_latitud, p_longitud
  );

  v_success := coalesce((v_ctx->>'success')::boolean, false);
  v_permitido := coalesce((v_ctx->>'permitido')::boolean, false);
  v_code := coalesce(v_ctx->>'code', 'error_interno');
  v_message := coalesce(v_ctx->>'message', 'No se pudo resolver el contexto de asistencia.');

  if not v_success or not v_permitido then
    return jsonb_build_object(
      'success', v_success,
      'registrado', false,
      'code', v_code,
      'message', v_message,
      'asistencia_id', null,
      'contexto', v_ctx,
      'warnings', coalesce(v_ctx->'warnings', '[]'::jsonb),
      'bloqueos', coalesce(v_ctx->'bloqueos', '[]'::jsonb)
    );
  end if;

  -- 2. Cargar campos resueltos
  v_tenant_id := nullif(v_ctx->>'tenant_id', '');
  v_curso_id := nullif(v_ctx->>'curso_id', '')::bigint;
  v_dni := coalesce(nullif(v_ctx->>'dni', ''), nullif(v_ctx #>> '{aspirante,dni}', ''));
  v_nombre := trim(concat_ws(' ',
    nullif(v_ctx #>> '{aspirante,nombres}', ''),
    nullif(v_ctx #>> '{aspirante,apellidos}', '')
  ));
  v_ubo := nullif(v_ctx #>> '{aspirante,ubo}', '');
  v_seccion := nullif(v_ctx->>'seccion', '');
  v_tipo_jornada := nullif(v_ctx->>'jornada_codigo', '');
  v_modalidad := nullif(v_ctx->>'modalidad', '');
  v_estado_asistencia := nullif(v_ctx->>'estado_asistencia', '');
  v_regla_jornada_id := nullif(v_ctx->>'regla_jornada_id', '')::uuid;
  v_origen_contexto := coalesce(nullif(v_ctx->>'origen_contexto', ''), 'fn_resolver_contexto_asistencia');

  v_timestamp_lima := timezone('America/Lima', coalesce(p_timestamp, now()));
  v_fecha_lima := v_timestamp_lima::date;
  v_hora_lima := v_timestamp_lima::time;
  
  v_warnings := coalesce(v_ctx->'warnings', '[]'::jsonb);

  -- 3. Validar duplicado exacto hoy
  if exists (
    select 1
    from public.asistencias a
    where a.tenant_id = v_tenant_id
      and a.curso_id = v_curso_id
      and a.dni = v_dni
      and a.fecha = v_fecha_lima
  ) then
    return jsonb_build_object(
      'success', true,
      'registrado', false,
      'code', 'asistencia_duplicada',
      'message', 'El aspirante ya registró asistencia hoy.',
      'asistencia_id', null,
      'contexto', v_ctx,
      'warnings', v_warnings,
      'bloqueos', coalesce(v_ctx->'bloqueos', '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object(
          'code', 'asistencia_duplicada',
          'message', 'El aspirante ya registró asistencia hoy.'
        ))
    );
  end if;

  -- 4. Detección formal de DNI distinto en el mismo dispositivo ('dni_en_otro_dispositivo')
  if p_device_id is not null and p_device_id <> '' then
    if exists (
      select 1
      from public.asistencias a
      where a.tenant_id = v_tenant_id
        and a.curso_id = v_curso_id
        and a.device_id = p_device_id
        and a.dni <> v_dni
    ) then
      -- Evitar duplicidad del mismo evento hoy
      if not exists (
        select 1
        from public.asistencia_alertas al
        where al.tenant_id = v_tenant_id
          and al.curso_id = v_curso_id
          and al.dni = v_dni
          and al.device_id = p_device_id
          and al.tipo = 'dni_en_otro_dispositivo'
          and al.fecha = v_fecha_lima
      ) then
        insert into public.asistencia_alertas (
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
        ) values (
          v_tenant_id,
          v_curso_id,
          v_fecha_lima,
          v_hora_lima,
          v_dni,
          v_nombre,
          v_ubo,
          v_seccion,
          'dni_en_otro_dispositivo',
          'El dispositivo ya ha sido utilizado por otro DNI en este curso (DNI actual: ' || v_dni || ').',
          p_device_id
        );
      end if;

      -- Inyectar warning para el flujo móvil del frontend
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'dni_en_otro_dispositivo',
        'message', 'Uso de dispositivo no habitual.'
      ));
    end if;
  end if;

  -- 5. Registrar asistencia
  insert into public.asistencias (
    dni, nombre, ubo, fecha, hora, timestamp_local,
    tenant_id, curso_id, seccion, tipo_jornada, modalidad,
    estado_asistencia, regla_jornada_id, origen_contexto,
    origen_registro, device_id, latitud, longitud
  ) values (
    v_dni, v_nombre, v_ubo, v_fecha_lima, v_hora_lima, p_timestamp,
    v_tenant_id, v_curso_id, v_seccion, v_tipo_jornada, v_modalidad,
    v_estado_asistencia, v_regla_jornada_id, v_origen_contexto,
    coalesce(nullif(trim(p_origen_registro), ''), 'qr_publico'),
    nullif(trim(p_device_id), ''), p_latitud, p_longitud
  )
  returning id into v_asistencia_id;

  return jsonb_build_object(
    'success', true,
    'registrado', true,
    'code', 'ok',
    'message', 'Asistencia registrada correctamente.',
    'asistencia_id', v_asistencia_id,
    'contexto', v_ctx,
    'warnings', v_warnings,
    'bloqueos', '[]'::jsonb
  );

exception when others then
  return jsonb_build_object(
    'success', false,
    'registrado', false,
    'code', 'error_interno',
    'message', 'No se pudo registrar la asistencia.',
    'asistencia_id', null,
    'contexto', coalesce(v_ctx, '{}'::jsonb),
    'warnings', coalesce(v_ctx->'warnings', '[]'::jsonb),
    'bloqueos', coalesce(v_ctx->'bloqueos', '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object('code', 'error_interno', 'message', SQLERRM))
  );
end;
$$;

commit;

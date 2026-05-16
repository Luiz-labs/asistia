begin;

set search_path = public;

create or replace function public.fn_resolver_contexto_asistencia(
  p_qr_token text,
  p_dni text,
  p_timestamp timestamptz default now(),
  p_device_id text default null,
  p_latitud numeric default null,
  p_longitud numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
begin
  v_lima_ts := timezone('America/Lima', v_ts);
  v_fecha_lima := v_lima_ts::date;
  v_hora_lima := v_lima_ts::time;
  v_dow := extract(dow from v_lima_ts)::smallint;

  if v_qr_token is null then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'qr_invalido',
      'message', 'Acceso no válido. Escanee el código QR oficial del curso.',
      'curso_id', null,
      'tenant_id', null,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'qr_invalido',
          'message', 'Acceso no válido. Escanee el código QR oficial del curso.'
        )
      ),
      'aspirante', null
    );
  end if;

  if length(v_dni) <> 8 then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'dni_invalido',
      'message', 'DNI no válido.',
      'curso_id', null,
      'tenant_id', null,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'dni_invalido',
          'message', 'DNI no válido.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', null,
        'apellidos', null,
        'ubo', null
      )
    );
  end if;

  select c.id, c.tenant_id, c.estado
    into v_curso_id, v_tenant_id, v_curso_estado
  from public.cursos c
  where c.qr_token = v_qr_token
  limit 1;

  if v_curso_id is null then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'qr_invalido',
      'message', 'Acceso no válido. Escanee el código QR oficial del curso.',
      'curso_id', null,
      'tenant_id', null,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'qr_invalido',
          'message', 'Acceso no válido. Escanee el código QR oficial del curso.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', null,
        'apellidos', null,
        'ubo', null
      )
    );
  end if;

  if coalesce(v_curso_estado, '') <> 'activo' then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'curso_inactivo',
      'message', 'El curso asociado al QR no está activo.',
      'curso_id', v_curso_id,
      'tenant_id', v_tenant_id,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'curso_inactivo',
          'message', 'El curso asociado al QR no está activo.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', null,
        'apellidos', null,
        'ubo', null
      )
    );
  end if;

  select
    a.nombres,
    a.apellidos,
    a.ubo,
    upper(trim(coalesce(a.seccion, ''))),
    a.curso_id
  into
    v_nombres,
    v_apellidos,
    v_ubo,
    v_seccion,
    v_asp_curso_id
  from public.aspirantes a
  where a.tenant_id = v_tenant_id
    and a.dni = v_dni
  limit 1;

  if v_nombres is null then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'dni_no_encontrado',
      'message', 'El DNI ingresado no existe en el padrón de la institución.',
      'curso_id', v_curso_id,
      'tenant_id', v_tenant_id,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'dni_no_encontrado',
          'message', 'El DNI ingresado no existe en el padrón de la institución.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', null,
        'apellidos', null,
        'ubo', null
      )
    );
  end if;

  if v_asp_curso_id is not null and v_asp_curso_id <> v_curso_id then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'aspirante_fuera_de_curso',
      'message', 'El aspirante no pertenece al curso de este QR.',
      'curso_id', v_curso_id,
      'tenant_id', v_tenant_id,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', v_seccion,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'aspirante_fuera_de_curso',
          'message', 'El aspirante no pertenece al curso de este QR.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', v_nombres,
        'apellidos', v_apellidos,
        'ubo', v_ubo
      )
    );
  end if;

  if coalesce(v_seccion, '') = '' or v_seccion in ('GENERAL', 'DOMINICAL') then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'aspirante_sin_seccion',
      'message', 'El aspirante no tiene sección asignada. Contacte al administrador.',
      'curso_id', v_curso_id,
      'tenant_id', v_tenant_id,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'aspirante_sin_seccion',
          'message', 'El aspirante no tiene sección asignada. Contacte al administrador.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', v_nombres,
        'apellidos', v_apellidos,
        'ubo', v_ubo
      )
    );
  end if;

  with candidatas as (
    select
      r.id as regla_id,
      j.codigo as jornada_codigo,
      j.nombre_visible as jornada_label,
      r.modalidad,
      case r.modalidad
        when 'PRESENCIAL' then 'Presencial'
        when 'VIRTUAL' then 'Virtual'
        else r.modalidad
      end as modalidad_label,
      r.hora_inicio,
      r.tolerancia_tardanza_min,
      r.permitir_registro_fuera_horario,
      r.requiere_gps,
      r.prioridad_resolucion,
      case when r.fecha_especifica = v_fecha_lima then 0 else 1 end as rank_fecha,
      case when r.seccion = v_seccion then 0 else 1 end as rank_spec
    from public.curso_jornada_reglas r
    join public.curso_jornadas j
      on j.id = r.jornada_id
    where r.tenant_id = v_tenant_id
      and r.curso_id = v_curso_id
      and r.activa = true
      and j.activa = true
      and (
        r.fecha_especifica = v_fecha_lima
        or (
          r.fecha_especifica is null
          and (r.vigente_desde is null or v_fecha_lima >= r.vigente_desde)
          and (r.vigente_hasta is null or v_fecha_lima <= r.vigente_hasta)
          and r.dias_semana is not null
          and v_dow = any(r.dias_semana)
        )
      )
      and (
        r.seccion = v_seccion
        or r.seccion is null
      )
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        order by
          c.rank_fecha asc,
          c.prioridad_resolucion asc,
          c.rank_spec asc,
          c.hora_inicio asc,
          c.regla_id asc
      ) as rn
    from candidatas c
  )
  select
    r.regla_id,
    r.jornada_codigo,
    r.jornada_label,
    r.modalidad,
    r.modalidad_label,
    r.hora_inicio,
    r.tolerancia_tardanza_min,
    r.permitir_registro_fuera_horario,
    r.requiere_gps,
    r.rank_fecha,
    r.rank_spec,
    r.prioridad_resolucion,
    s.rank_fecha,
    s.rank_spec,
    s.prioridad_resolucion,
    s.hora_inicio
  into
    v_regla_id,
    v_jornada_codigo,
    v_jornada_label,
    v_modalidad,
    v_modalidad_label,
    v_hora_inicio,
    v_tolerancia_tardanza_min,
    v_permitir_fuera_horario,
    v_requiere_gps,
    v_rank_fecha,
    v_rank_spec,
    v_prioridad,
    v_second_rank_fecha,
    v_second_rank_spec,
    v_second_prioridad,
    v_second_hora_inicio
  from ranked r
  left join ranked s
    on s.rn = 2
  where r.rn = 1;

  if v_regla_id is null then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'sin_jornada_programada',
      'message', 'No hay una jornada programada para este aspirante en este momento.',
      'curso_id', v_curso_id,
      'tenant_id', v_tenant_id,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', v_seccion,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'sin_jornada_programada',
          'message', 'No hay una jornada programada para este aspirante en este momento.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', v_nombres,
        'apellidos', v_apellidos,
        'ubo', v_ubo
      )
    );
  end if;

  if v_second_prioridad is not null
     and v_second_rank_fecha = v_rank_fecha
     and v_second_rank_spec = v_rank_spec
     and v_second_prioridad = v_prioridad
     and v_second_hora_inicio = v_hora_inicio then
    return jsonb_build_object(
      'success', true,
      'permitido', false,
      'code', 'configuracion_ambigua',
      'message', 'La configuración del curso es ambigua para esta fecha y sección.',
      'curso_id', v_curso_id,
      'tenant_id', v_tenant_id,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', v_seccion,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', v_origen_contexto,
      'warnings', v_warnings,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'configuracion_ambigua',
          'message', 'La configuración del curso es ambigua para esta fecha y sección.'
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', v_nombres,
        'apellidos', v_apellidos,
        'ubo', v_ubo
      )
    );
  end if;

  if v_hora_lima <= v_hora_inicio then
    v_estado_asistencia := 'PUNTUAL';
  elsif v_hora_lima <= (v_hora_inicio + make_interval(mins => coalesce(v_tolerancia_tardanza_min, 15)))::time then
    v_estado_asistencia := 'TARDANZA';
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'tardanza',
        'message', 'Registro en tardanza.'
      )
    );
  else
    v_estado_asistencia := 'FUERA_DE_HORARIO';
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'fuera_de_horario',
        'message', 'Registro fuera de horario.'
      )
    );
  end if;

  if v_estado_asistencia = 'FUERA_DE_HORARIO' and not coalesce(v_permitir_fuera_horario, false) then
    v_permitido := false;
    v_code := 'fuera_de_horario';
    v_message := 'La jornada no permite registros fuera de horario.';
    v_bloqueos := v_bloqueos || jsonb_build_array(
      jsonb_build_object(
        'code', 'fuera_de_horario',
        'message', 'La jornada no permite registros fuera de horario.'
      )
    );
  else
    v_permitido := true;
    v_code := 'ok';
    v_message := 'Contexto resuelto correctamente.';
  end if;

  if coalesce(v_requiere_gps, false) and (p_latitud is null or p_longitud is null) then
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'gps_no_disponible',
        'message', 'La regla tiene validación GPS preparada, pero no se enviaron coordenadas.'
      )
    );
  end if;

  if nullif(trim(coalesce(p_device_id, '')), '') is null then
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'device_id_ausente',
        'message', 'No se recibió identificador de dispositivo.'
      )
    );
  end if;

  v_nombre_completo := trim(concat_ws(' ', v_nombres, v_apellidos));

  return jsonb_build_object(
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
    'warnings', coalesce(v_warnings, '[]'::jsonb),
    'bloqueos', coalesce(v_bloqueos, '[]'::jsonb),
    'aspirante', jsonb_build_object(
      'dni', v_dni,
      'nombres', v_nombres,
      'apellidos', v_apellidos,
      'ubo', v_ubo,
      'nombre', v_nombre_completo
    )
  );

exception
  when others then
    return jsonb_build_object(
      'success', false,
      'permitido', false,
      'code', 'error_interno',
      'message', 'No se pudo resolver el contexto de asistencia.',
      'curso_id', null,
      'tenant_id', null,
      'jornada_codigo', null,
      'jornada_label', null,
      'modalidad', null,
      'modalidad_label', null,
      'seccion', null,
      'estado_asistencia', null,
      'hora_inicio', null,
      'regla_jornada_id', null,
      'origen_contexto', 'fn_resolver_contexto_asistencia',
      'warnings', '[]'::jsonb,
      'bloqueos', jsonb_build_array(
        jsonb_build_object(
          'code', 'error_interno',
          'message', SQLERRM
        )
      ),
      'aspirante', jsonb_build_object(
        'dni', v_dni,
        'nombres', null,
        'apellidos', null,
        'ubo', null
      )
    );
end;
$$;

create or replace function public.rpc_resolver_contexto_asistencia(
  p_qr_token text,
  p_dni text,
  p_timestamp timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public.fn_resolver_contexto_asistencia(
    p_qr_token,
    p_dni,
    p_timestamp,
    null,
    null,
    null
  );
end;
$$;

commit;

create table if not exists public.cursos (
  tenant_id text not null default '',
  id bigint not null default 1,
  nombre text null,
  fecha_inicio date null,
  fecha_fin date null,
  estado text not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cursos_pkey primary key (tenant_id, id),
  constraint cursos_estado_check check (estado in ('activo', 'inactivo'))
);

create index if not exists cursos_estado_idx
  on public.cursos (estado);

insert into public.cursos (
  tenant_id,
  id,
  nombre,
  fecha_inicio,
  fecha_fin,
  estado
)
select
  coalesce(cc.tenant_id, '') as tenant_id,
  1 as id,
  nullif(trim(coalesce(cc.nombre_curso, '')), '') as nombre,
  cc.fecha_inicio,
  cc.fecha_fin,
  'activo' as estado
from public.curso_configuracion cc
where not exists (
  select 1
  from public.cursos c
  where c.tenant_id = coalesce(cc.tenant_id, '')
    and c.id = 1
);

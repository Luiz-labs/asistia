create extension if not exists pgcrypto;

create table if not exists public.staff_instruccion (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    curso_id bigint null,
    codigo_bombero text not null,
    nombres text not null,
    apellidos text not null,
    grado text null,
    ubo_origen text null,
    tipo_staff text not null check (tipo_staff in ('APOYO', 'ADJUNTO')),
    celular text null,
    correo text null,
    foto_url text null,
    activo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists staff_instruccion_tenant_codigo_uidx
    on public.staff_instruccion (tenant_id, codigo_bombero);

create index if not exists staff_instruccion_tenant_activo_idx
    on public.staff_instruccion (tenant_id, activo, tipo_staff);

create table if not exists public.staff_asistencias (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    curso_id bigint null,
    staff_id uuid not null references public.staff_instruccion (id) on delete restrict,
    codigo_bombero text not null,
    nombre text not null,
    grado text null,
    ubo_origen text null,
    tipo_staff text not null check (tipo_staff in ('APOYO', 'ADJUNTO')),
    fecha date not null default current_date,
    hora_ingreso time not null default current_time,
    jornada text null,
    origen_registro text not null default 'qr_staff',
    device_id text null,
    created_at timestamptz not null default now()
);

create unique index if not exists staff_asistencias_tenant_staff_fecha_uidx
    on public.staff_asistencias (tenant_id, staff_id, fecha);

create index if not exists staff_asistencias_reporte_idx
    on public.staff_asistencias (tenant_id, fecha desc, tipo_staff, ubo_origen);

create or replace function public.set_staff_instruccion_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_staff_instruccion_updated_at on public.staff_instruccion;
create trigger trg_staff_instruccion_updated_at
before update on public.staff_instruccion
for each row
execute function public.set_staff_instruccion_updated_at();

-- RLS:
-- Este script no crea ni altera políticas.
-- Si RLS ya está activo en tu proyecto, replica la política tenant-aware existente
-- antes de habilitar escritura desde el backoffice o la pantalla pública.

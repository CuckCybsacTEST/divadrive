create extension if not exists "pgcrypto";

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '');
$$;

create or replace function public.is_ops_role()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('operator', 'admin');
$$;

create table if not exists passenger_profiles (
  id text primary key,
  full_name text not null,
  phone text not null,
  city text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists driver_profiles (
  id text primary key,
  full_name text not null,
  phone text not null,
  city text not null,
  approval_status text not null check (approval_status in ('pending', 'approved', 'rejected')),
  documents_submitted boolean not null default false,
  license_number text not null,
  vehicle_description text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists trips (
  id text primary key,
  passenger_id text not null,
  passenger_name text not null,
  driver_id text,
  driver_name text,
  status text not null,
  requested_at timestamptz not null,
  requested_promo_code text,
  origin jsonb not null,
  destination jsonb not null,
  estimate jsonb not null,
  driver_eta_minutes integer,
  current_driver_location jsonb,
  cancellation_reason text,
  cancelled_by_role text,
  cancelled_at timestamptz
);

create index if not exists trips_passenger_id_idx on trips (passenger_id);
create index if not exists trips_driver_id_idx on trips (driver_id);
create index if not exists trips_status_idx on trips (status);

create table if not exists trip_incidents (
  id text primary key,
  trip_id text not null references trips (id) on delete cascade,
  reporter_role text not null,
  reporter_id text not null,
  severity text not null,
  category text not null,
  notes text not null,
  status text not null,
  created_at timestamptz not null
);

create index if not exists trip_incidents_trip_id_idx on trip_incidents (trip_id);

create table if not exists trip_events (
  id text primary key,
  trip_id text not null references trips (id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null,
  actor_id text,
  actor_role text,
  message text not null
);

create index if not exists trip_events_trip_id_idx on trip_events (trip_id);
create index if not exists trip_events_occurred_at_idx on trip_events (occurred_at desc);

create table if not exists api_sessions (
  access_token text primary key,
  user_id text not null,
  role text not null,
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists api_sessions_user_id_idx on api_sessions (user_id);
create index if not exists api_sessions_role_idx on api_sessions (role);

create table if not exists business_config (
  id uuid primary key default gen_random_uuid(),
  pricing jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists promotions (
  id text primary key,
  name text not null,
  code text not null unique,
  kind text not null,
  audience text not null,
  apply_mode text not null,
  value numeric(10,2) not null,
  min_fare numeric(10,2) not null,
  description text not null,
  is_active boolean not null default true,
  created_at timestamptz not null
);

create table if not exists business_audit_log (
  id text primary key,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  summary text not null,
  occurred_at timestamptz not null
);

alter table passenger_profiles enable row level security;
alter table driver_profiles enable row level security;
alter table trips enable row level security;
alter table trip_incidents enable row level security;
alter table trip_events enable row level security;
alter table api_sessions enable row level security;
alter table business_config enable row level security;
alter table promotions enable row level security;
alter table business_audit_log enable row level security;

drop policy if exists passenger_profiles_self_read on passenger_profiles;
create policy passenger_profiles_self_read
on passenger_profiles
for select
to authenticated
using (id = auth.uid()::text or public.is_ops_role());

drop policy if exists driver_profiles_role_read on driver_profiles;
create policy driver_profiles_role_read
on driver_profiles
for select
to authenticated
using (id = auth.uid()::text or public.is_ops_role());

drop policy if exists trips_role_read on trips;
create policy trips_role_read
on trips
for select
to authenticated
using (
  passenger_id = auth.uid()::text
  or driver_id = auth.uid()::text
  or public.is_ops_role()
);

drop policy if exists trip_incidents_role_read on trip_incidents;
create policy trip_incidents_role_read
on trip_incidents
for select
to authenticated
using (
  reporter_id = auth.uid()::text
  or exists (
    select 1
    from trips
    where trips.id = trip_incidents.trip_id
      and (
        trips.passenger_id = auth.uid()::text
        or trips.driver_id = auth.uid()::text
        or public.is_ops_role()
      )
  )
);

drop policy if exists trip_events_role_read on trip_events;
create policy trip_events_role_read
on trip_events
for select
to authenticated
using (
  exists (
    select 1
    from trips
    where trips.id = trip_events.trip_id
      and (
        trips.passenger_id = auth.uid()::text
        or trips.driver_id = auth.uid()::text
        or public.is_ops_role()
      )
  )
);

drop policy if exists business_config_ops_read on business_config;
create policy business_config_ops_read
on business_config
for select
to authenticated
using (public.is_ops_role());

drop policy if exists promotions_ops_read on promotions;
create policy promotions_ops_read
on promotions
for select
to authenticated
using (public.is_ops_role());

drop policy if exists business_audit_log_ops_read on business_audit_log;
create policy business_audit_log_ops_read
on business_audit_log
for select
to authenticated
using (public.is_ops_role());

drop policy if exists api_sessions_no_client_access on api_sessions;
create policy api_sessions_no_client_access
on api_sessions
for select
to authenticated
using (false);

alter publication supabase_realtime add table passenger_profiles;
alter publication supabase_realtime add table driver_profiles;
alter publication supabase_realtime add table trips;
alter publication supabase_realtime add table trip_incidents;
alter publication supabase_realtime add table trip_events;
alter publication supabase_realtime add table business_config;
alter publication supabase_realtime add table promotions;
alter publication supabase_realtime add table business_audit_log;

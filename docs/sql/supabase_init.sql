create extension if not exists "pgcrypto";

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
alter table business_config enable row level security;
alter table promotions enable row level security;
alter table business_audit_log enable row level security;

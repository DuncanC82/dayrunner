-- Tours as the unit of work (docs/features/tours.md): a multi-day tour with itinerary-grade
-- stops and audience-tagged notes. Existing day plans (departures) can hang off a tour day.

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  group_pax integer,
  status text not null default 'draft',          -- draft | confirmed | running | done | cancelled
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists tours_operator_start on public.tours (operator_id, start_date);

create table if not exists public.tour_days (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  date date,
  day_number integer not null,
  title text,
  overnight_location text,
  unique (tour_id, day_number)
);
create index if not exists tour_days_tour on public.tour_days (tour_id, day_number);

create table if not exists public.stops (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  tour_id uuid not null references public.tours(id) on delete cascade,
  tour_day_id uuid not null references public.tour_days(id) on delete cascade,
  departure_id uuid references public.departures(id) on delete set null,
  time time,
  name text not null,
  category text not null default 'activity'
    check (category = any (array['activity','meal_breakfast','meal_lunch','meal_dinner','accommodation','transport','other'])),
  supplier_id uuid references public.suppliers(id) on delete set null,
  address text,
  phone text,
  reference text,
  blurb text,
  sequence integer not null default 0
);
create index if not exists stops_day_order on public.stops (tour_day_id, time, sequence);

create table if not exists public.stop_notes (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references public.stops(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  audience text not null default 'guide'
    check (audience = any (array['guide','group','office','driver'])),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists stop_notes_stop on public.stop_notes (stop_id, created_at);

alter table public.departures add column if not exists tour_id uuid references public.tours(id) on delete set null;
alter table public.departures add column if not exists tour_day_id uuid references public.tour_days(id) on delete set null;
create index if not exists departures_tour_day on public.departures (tour_day_id);

alter table public.tours enable row level security;
alter table public.tour_days enable row level security;
alter table public.stops enable row level security;
alter table public.stop_notes enable row level security;
drop policy if exists tours_member on public.tours;
create policy tours_member on public.tours for all using (is_member(operator_id)) with check (is_member(operator_id));
drop policy if exists tour_days_member on public.tour_days;
create policy tour_days_member on public.tour_days for all using (is_member(operator_id)) with check (is_member(operator_id));
drop policy if exists stops_member on public.stops;
create policy stops_member on public.stops for all using (is_member(operator_id)) with check (is_member(operator_id));
drop policy if exists stop_notes_member on public.stop_notes;
create policy stop_notes_member on public.stop_notes for all using (is_member(operator_id)) with check (is_member(operator_id));

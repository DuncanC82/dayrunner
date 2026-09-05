-- Driver work-time compliance and mileage (docs/features/driver-hours.md)
-- Land Transport Rule: Work Time and Logbooks 2007 — 5.5h/30min, 13h day, 10h rest, 70h/24h.

alter table public.staff add column if not exists prior_work_minutes_today integer not null default 0;

create table if not exists public.work_log (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  minutes_work integer not null default 0,
  minutes_drive integer not null default 0,
  km numeric not null default 0,
  source text not null default 'manual',   -- 'plan' | 'manual' | 'logbook' | 'import'
  created_at timestamptz not null default now(),
  unique (staff_id, date, source)
);
create index if not exists work_log_staff_date on public.work_log (staff_id, date);
alter table public.work_log enable row level security;
drop policy if exists work_log_member on public.work_log;
create policy work_log_member on public.work_log for all using (is_member(operator_id)) with check (is_member(operator_id));

alter table public.departures add column if not exists route_km numeric;
alter table public.products   add column if not exists route_km numeric;

alter table public.allocations add column if not exists km numeric;
alter table public.allocations add column if not exists work_minutes integer;
alter table public.allocations add column if not exists breaks jsonb not null default '[]'::jsonb;  -- [{after:"HH:MM", minutes:30}]

-- rules keys used by the planner (no schema change; documented here):
--   worktime_regime  'logbook' | 'none'   (default 'logbook')
--   km_per_stop      numeric              (default 4)
--   prep_minutes     integer              (default 15, applied before pickups and after return)

-- 10h continuous rest: record each driver's planned start/finish so the next day's plan can check the gap.
alter table public.work_log add column if not exists start_minute integer;
alter table public.work_log add column if not exists finish_minute integer;

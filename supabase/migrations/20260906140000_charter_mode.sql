-- Charter mode + transport requests (docs/features/charter-mode.md)
-- operators.settings.ops_mode = 'fleet' | 'charter' (default fleet). No schema change; documented here.

-- suppliers.category: pin the allowed set (transport included) so the UI grouping is stable.
alter table public.suppliers drop constraint if exists suppliers_category_check;
alter table public.suppliers add constraint suppliers_category_check
  check (category = any (array['activity','meal_breakfast','meal_lunch','meal_dinner','transport','accommodation','other']));

create table if not exists public.transport_requests (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  tour_id uuid,                                    -- no FK: tours table is being built concurrently
  date_from date not null,
  date_to date not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  vehicle_spec text not null,                      -- "18-seat Sprinter with trailer"
  price numeric,
  currency text not null default 'NZD',
  driver_name text,
  driver_phone text,
  driver_meals_included boolean not null default false,
  driver_accommodation_included boolean not null default false,
  status text not null default 'pending' check (status = any (array['pending','requested','confirmed','declined'])),
  notes text,
  message_body text,
  sent_at timestamptz,
  reply_text text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);
create index if not exists transport_requests_op_dates on public.transport_requests (operator_id, date_from, date_to);
alter table public.transport_requests enable row level security;
drop policy if exists transport_requests_member on public.transport_requests;
create policy transport_requests_member on public.transport_requests for all using (is_member(operator_id)) with check (is_member(operator_id));

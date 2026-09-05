-- Group composition + rooming + per-day overview/inclusions (docs/features/group-and-day-sheet.md).
-- "How many adults, how many kids, how many boys, how many girls. What kind of combination are we booking for them?"

alter table public.tours add column if not exists adults integer not null default 0;
alter table public.tours add column if not exists children integer not null default 0;
alter table public.tours add column if not exists boys integer not null default 0;
alter table public.tours add column if not exists girls integer not null default 0;
alter table public.tours add column if not exists group_notes text;

create table if not exists public.rooming (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  tour_id uuid not null references public.tours(id) on delete cascade,
  room_type text not null default 'twin'
    check (room_type = any (array['twin','double','single','triple','family'])),
  occupants text,                 -- free text: "1 adult + 1 child" or names
  count integer not null default 1,
  notes text,
  sequence integer not null default 0
);
create index if not exists rooming_tour on public.rooming (tour_id, sequence);

alter table public.tour_days add column if not exists inclusions jsonb not null default '{}'::jsonb;  -- {transport,breakfast,lunch,dinner: bool}
alter table public.tour_days add column if not exists overview text;                                   -- plain-language summary of the day

alter table public.rooming enable row level security;
drop policy if exists rooming_member on public.rooming;
create policy rooming_member on public.rooming for all using (is_member(operator_id)) with check (is_member(operator_id));

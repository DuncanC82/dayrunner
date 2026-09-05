-- Gmail connector: send from the operator's own Google Workspace address, read replies from their inbox.
-- connectors.kind 'gmail': secret = Google refresh token; config = { email, history_id, last_poll_at, label_ids }.
alter table public.connectors drop constraint if exists connectors_kind_check;
alter table public.connectors add constraint connectors_kind_check
  check (kind = any (array['rezdy','fareharbor','rcm','csv','email','gmail']));
create unique index if not exists connectors_operator_gmail_uniq on public.connectors (operator_id) where kind = 'gmail';

-- Thread ids so replies can be matched back to what we sent.
alter table public.supplier_confirmations add column if not exists gmail_thread_id text;
alter table public.transport_requests add column if not exists gmail_thread_id text;
create index if not exists supplier_confirmations_gmail_thread_idx on public.supplier_confirmations (gmail_thread_id) where gmail_thread_id is not null;
create index if not exists transport_requests_gmail_thread_idx on public.transport_requests (gmail_thread_id) where gmail_thread_id is not null;

-- Every inbound message we pulled from the operator's inbox, and what it matched.
create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  connector_id uuid references public.connectors(id) on delete set null,
  gmail_message_id text not null unique,
  thread_id text,
  from_email text,
  subject text,
  snippet text,
  body_text text,
  received_at timestamptz,
  matched_to text not null default 'none' check (matched_to = any (array['supplier_confirmation','transport_request','booking','none'])),
  matched_id uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists inbound_emails_op_received on public.inbound_emails (operator_id, received_at desc);
alter table public.inbound_emails enable row level security;
drop policy if exists inbound_emails_member on public.inbound_emails;
create policy inbound_emails_member on public.inbound_emails for all using (is_member(operator_id)) with check (is_member(operator_id));

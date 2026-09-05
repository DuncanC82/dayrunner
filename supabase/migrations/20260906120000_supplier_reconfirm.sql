-- Supplier reconfirmation: categories, email address, send/reply tracking.
alter table public.suppliers
  add column if not exists category text not null default 'activity',
  add column if not exists email text;

alter table public.supplier_confirmations
  add column if not exists message_body text,
  add column if not exists sent_at timestamptz,
  add column if not exists reply_text text,
  add column if not exists replied_at timestamptz;

create index if not exists supplier_confirmations_supplier_sent_idx
  on public.supplier_confirmations (supplier_id, sent_at desc);

-- Allow an 'email' connector to hold the inbound-reply webhook token.
alter table public.connectors drop constraint if exists connectors_kind_check;
alter table public.connectors add constraint connectors_kind_check
  check (kind = any (array['rezdy','fareharbor','rcm','csv','email']));

-- Status lifecycle: pending | hold -> sent | sent_manual -> replied | confirmed (failed on provider error).
alter table public.supplier_confirmations drop constraint if exists supplier_confirmations_status_check;
alter table public.supplier_confirmations add constraint supplier_confirmations_status_check
  check (status = any (array['pending','hold','sent','sent_manual','replied','confirmed','failed']));

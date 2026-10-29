-- Cooket payment links: durable storage for the payment link server (Vercel Function).
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Security model: the server talks to these tables with the SERVICE ROLE key, which bypasses row level security.
-- RLS is enabled with NO policies and all privileges are revoked from the public roles, so the anon and
-- authenticated keys (which may end up in a browser) can read and write nothing here.

create table if not exists public.payment_links (
  id          text primary key,
  owner_did   text   not null,
  recipient   text   not null,
  description text   not null check (char_length(description) between 1 and 140),
  merchant    text   check (merchant is null or char_length(merchant) <= 60),
  mode        text   not null check (mode in ('fixed', 'open')),
  -- Raw 6-decimal USDC units as a decimal string. Required for fixed links.
  amount_raw  text   check (amount_raw is null or amount_raw ~ '^[0-9]{1,30}$'),
  expires_at  bigint,
  created_at  bigint not null,
  inactive    boolean not null default false,
  -- The CooketPayRouter this link settles through. Null for links that use direct USDC transfers.
  router      text,
  constraint fixed_links_have_amount check (mode <> 'fixed' or amount_raw is not null)
);

create index if not exists payment_links_owner_idx on public.payment_links (owner_did, created_at desc);

create table if not exists public.link_payments (
  link_id      text    not null references public.payment_links (id) on delete restrict,
  -- Lowercase transaction hash. With log_index this identifies one onchain transfer.
  tx_hash      text    not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index    integer not null,
  payer        text    not null,
  amount_raw   text    not null check (amount_raw ~ '^[0-9]{1,30}$'),
  block_number text    not null,
  paid_at      bigint  not null,
  verified_at  bigint  not null,
  -- A transfer can pay one link, once. This is what stops a payment being claimed twice or by another link.
  primary key (tx_hash, log_index)
);

create index if not exists link_payments_link_idx on public.link_payments (link_id, paid_at);

-- Burns each creation signature nonce so a signed message cannot be replayed to create more links.
create table if not exists public.used_nonces (
  nonce   text   primary key,
  used_at bigint not null
);

alter table public.payment_links enable row level security;
alter table public.link_payments enable row level security;
alter table public.used_nonces   enable row level security;

revoke all on public.payment_links from anon, authenticated;
revoke all on public.link_payments from anon, authenticated;
revoke all on public.used_nonces   from anon, authenticated;

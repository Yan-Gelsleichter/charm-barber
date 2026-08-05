-- Cartões salvos do cliente (Mercado Pago Customers & Cards).
-- Rode no SQL Editor do Supabase.

-- 1) Public key da conta Mercado Pago (necessária para tokenizar o cartão no navegador).
alter table public.barbershops add column if not exists mp_public_key text;
alter table public.barbers add column if not exists mp_public_key text;

-- 2) Tabela de cartões salvos
create table if not exists public.saved_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barbershop_id uuid,
  mp_collector_id text not null,          -- conta MP dona do customer (barbearia ou barbeiro)
  mp_customer_id text not null,
  mp_card_id text not null,
  last_four text,
  brand text,
  cardholder_name text,
  expiration_month int,
  expiration_year int,
  created_at timestamptz not null default now(),
  unique (user_id, mp_collector_id, mp_card_id)
);

create index if not exists saved_cards_user_idx on public.saved_cards (user_id);

grant select, insert, update, delete on public.saved_cards to authenticated;
grant all on public.saved_cards to service_role;

alter table public.saved_cards enable row level security;

drop policy if exists "own cards select" on public.saved_cards;
create policy "own cards select" on public.saved_cards
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own cards delete" on public.saved_cards;
create policy "own cards delete" on public.saved_cards
  for delete to authenticated using (auth.uid() = user_id);

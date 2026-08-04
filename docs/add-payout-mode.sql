-- Modelo de repasse financeiro + contas Mercado Pago por barbeiro (split).
-- Rode no SQL Editor do Supabase.

alter table public.barbershops
  add column if not exists payout_mode text not null default 'unica';

-- valores aceitos: 'unica' | 'split'
alter table public.barbers
  add column if not exists mp_user_id text,
  add column if not exists mp_access_token text,
  add column if not exists mp_refresh_token text,
  add column if not exists commission_percent numeric;

-- Tokens são sensíveis: nunca exponha mp_access_token/mp_refresh_token ao cliente.
revoke select (mp_access_token, mp_refresh_token) on public.barbers from anon, authenticated;

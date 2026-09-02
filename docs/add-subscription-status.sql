-- =====================================================================
-- VIP BARBER — Estado da assinatura da barbearia (teste grátis, etc.)
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.barbershops
  add column if not exists subscription_status text not null default 'trial',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists subscription_id text,
  add column if not exists current_period_ends_at timestamptz;

-- "not valid" não checa as linhas que já existem hoje, só passa a exigir
-- daqui pra frente — evita quebrar o script se alguma barbearia já tiver
-- um valor fora do esperado nessa coluna nova.
alter table public.barbershops
  drop constraint if exists barbershops_subscription_status_check;
alter table public.barbershops
  add constraint barbershops_subscription_status_check
  check (subscription_status in ('trial', 'active', 'past_due', 'canceled'))
  not valid;

-- Valores usados em barbershops.subscription_status:
--   trial | active | past_due | canceled

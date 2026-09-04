-- =====================================================================
-- VIP BARBER — Escolha de plano e upgrade agendado (assinatura da
-- barbearia com a própria plataforma). Migração aditiva.
-- Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.barbershops
  add column if not exists subscription_plan text,
  add column if not exists pending_plan_change text,
  add column if not exists mp_payer_email text;

-- "not valid" não checa as linhas que já existem hoje, só passa a exigir
-- daqui pra frente — mesmo padrão de docs/add-subscription-status.sql.
alter table public.barbershops
  drop constraint if exists barbershops_subscription_plan_check;
alter table public.barbershops
  add constraint barbershops_subscription_plan_check
  check (subscription_plan is null or subscription_plan in ('monthly', 'yearly'))
  not valid;

alter table public.barbershops
  drop constraint if exists barbershops_pending_plan_change_check;
alter table public.barbershops
  add constraint barbershops_pending_plan_change_check
  check (pending_plan_change is null or pending_plan_change in ('yearly'))
  not valid;

-- Valores usados em barbershops.subscription_plan: monthly | yearly
-- Valores usados em barbershops.pending_plan_change: yearly (só upgrade, sem downgrade por enquanto)

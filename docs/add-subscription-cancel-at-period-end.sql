-- =====================================================================
-- VIP BARBER — Cancelamento agendado da assinatura da plataforma (o
-- admin cancela pelo painel, mas mantém acesso até o fim do período já
-- pago). Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.barbershops
  add column if not exists cancel_at_period_end boolean not null default false;

-- =====================================================================
-- VIP BARBER — Permitir/desativar pagamento presencial na tela do
-- cliente (ativado por padrão). Migração aditiva.
-- Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.barbershops
  add column if not exists allow_local_payment boolean not null default true;

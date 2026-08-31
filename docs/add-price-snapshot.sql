-- =====================================================================
-- VIP BARBER — Preço do serviço no momento do agendamento
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

-- Guarda o preço do serviço no instante em que o agendamento foi criado,
-- pra relatórios (Produção, histórico) não mudarem retroativamente se o
-- admin alterar o preço do serviço depois. Agendamentos já existentes
-- ficam com o valor NULL (são todos de teste) — só os criados a partir
-- de agora recebem esse valor automaticamente.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS service_price_snapshot numeric;

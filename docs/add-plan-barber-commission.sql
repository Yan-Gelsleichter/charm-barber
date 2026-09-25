-- =====================================================================
-- APP BARBEARIAS — Porcentagem de cada barbeiro em cada plano de assinatura
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- Pré-requisito: já ter rodado docs/add-subscription-plan-details.sql.
-- Pode rodar várias vezes sem problema.
-- =====================================================================

-- 1) Quanto (%) o barbeiro recebe pelos atendimentos desse plano ---------
ALTER TABLE public.subscription_plan_barbers
  ADD COLUMN IF NOT EXISTS commission_percent numeric NOT NULL DEFAULT 0
    CHECK (commission_percent >= 0 AND commission_percent <= 100);

-- 2) Barbeiros da barbearia podem CONSULTAR (só leitura) as assinaturas ----
-- Necessário pra aba "Produção" do barbeiro saber de qual plano veio cada
-- atendimento de assinante e, assim, aplicar a porcentagem certa. Continua
-- sem nenhuma permissão de escrita — só o servidor grava assinaturas.
DROP POLICY IF EXISTS cs_select_barbers ON public.client_subscriptions;
CREATE POLICY cs_select_barbers ON public.client_subscriptions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.user_id = auth.uid() AND b.barbershop_id = client_subscriptions.barbershop_id
    )
  );

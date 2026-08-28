-- =====================================================================
-- VIP BARBER — Assinaturas mensais (planos)
-- Migração aditiva (sem renomear nada). Cole no SQL Editor do Supabase
-- (mesmo projeto do app) e clique Run. Pode rodar várias vezes.
-- =====================================================================

-- 0) Função helper: usuário logado é admin da barbearia informada? ----
CREATE OR REPLACE FUNCTION public.is_admin_of_barbershop(_barbershop_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.barbers
    WHERE user_id = auth.uid() AND is_admin = true AND barbershop_id = _barbershop_id
  );
$$;

-- 1) Planos de assinatura ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL,
  name         text NOT NULL,
  price        numeric NOT NULL CHECK (price > 0),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_plans_barbershop_idx
  ON public.subscription_plans (barbershop_id);

-- 2) Serviços inclusos em cada plano (ilimitados) ----------------------
CREATE TABLE IF NOT EXISTS public.subscription_plan_services (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  UNIQUE (plan_id, service_id)
);
CREATE INDEX IF NOT EXISTS subscription_plan_services_plan_idx
  ON public.subscription_plan_services (plan_id);

-- 3) Assinaturas dos clientes -------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id               uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  barbershop_id         uuid NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'active', 'paused', 'cancelled', 'payment_failed')),
  mp_preapproval_id     text,
  mp_payer_email        text,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_subscriptions_client_idx     ON public.client_subscriptions (client_id);
CREATE INDEX IF NOT EXISTS client_subscriptions_barbershop_idx ON public.client_subscriptions (barbershop_id);
CREATE INDEX IF NOT EXISTS client_subscriptions_plan_idx       ON public.client_subscriptions (plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_subscriptions_mp_preapproval_idx
  ON public.client_subscriptions (mp_preapproval_id) WHERE mp_preapproval_id IS NOT NULL;

-- 4) Histórico de cobranças de cada assinatura ---------------------------
CREATE TABLE IF NOT EXISTS public.subscription_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.client_subscriptions(id) ON DELETE CASCADE,
  mp_payment_id   text,
  amount          numeric,
  status          text,
  period_start    timestamptz,
  period_end      timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_charges_subscription_idx
  ON public.subscription_charges (subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_charges_mp_payment_idx
  ON public.subscription_charges (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

-- 5) Agendamento coberto por assinatura (usado numa fase futura) ---------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS covered_by_subscription_id uuid
    REFERENCES public.client_subscriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS appointments_covered_by_subscription_idx
  ON public.appointments (covered_by_subscription_id);

-- 6) GRANTs ---------------------------------------------------------------
GRANT SELECT                         ON public.subscription_plans          TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE         ON public.subscription_plans          TO authenticated;
GRANT ALL                            ON public.subscription_plans          TO service_role;

GRANT SELECT                         ON public.subscription_plan_services  TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE         ON public.subscription_plan_services  TO authenticated;
GRANT ALL                            ON public.subscription_plan_services  TO service_role;

-- Assinaturas e cobranças só são gravadas pelo servidor (service role);
-- o painel/cliente só leem.
GRANT SELECT                         ON public.client_subscriptions        TO authenticated;
GRANT ALL                            ON public.client_subscriptions        TO service_role;

GRANT SELECT                         ON public.subscription_charges        TO authenticated;
GRANT ALL                            ON public.subscription_charges        TO service_role;

-- 7) RLS --------------------------------------------------------------------
ALTER TABLE public.subscription_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_services  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_charges        ENABLE ROW LEVEL SECURITY;

-- Planos: leitura pública dos ativos (tela de assinatura do cliente) +
-- leitura/escrita total para o admin da barbearia dona do plano.
DROP POLICY IF EXISTS sp_select_active_or_admin ON public.subscription_plans;
CREATE POLICY sp_select_active_or_admin ON public.subscription_plans FOR SELECT
  USING (active = true OR public.is_admin_of_barbershop(barbershop_id));

DROP POLICY IF EXISTS sp_write_admin ON public.subscription_plans;
CREATE POLICY sp_write_admin ON public.subscription_plans FOR ALL TO authenticated
  USING (public.is_admin_of_barbershop(barbershop_id))
  WITH CHECK (public.is_admin_of_barbershop(barbershop_id));

-- Serviços inclusos: leitura pública quando o plano está ativo (ou admin);
-- escrita só pelo admin dono do plano.
DROP POLICY IF EXISTS sps_select_public_or_admin ON public.subscription_plan_services;
CREATE POLICY sps_select_public_or_admin ON public.subscription_plan_services FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscription_plans p
      WHERE p.id = plan_id AND (p.active = true OR public.is_admin_of_barbershop(p.barbershop_id))
    )
  );

DROP POLICY IF EXISTS sps_write_admin ON public.subscription_plan_services;
CREATE POLICY sps_write_admin ON public.subscription_plan_services FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.subscription_plans p WHERE p.id = plan_id AND public.is_admin_of_barbershop(p.barbershop_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.subscription_plans p WHERE p.id = plan_id AND public.is_admin_of_barbershop(p.barbershop_id))
  );

-- Assinaturas de clientes: o próprio cliente vê a sua; o admin da
-- barbearia vê todas. Sem policy de escrita — só o servidor (service role) grava.
DROP POLICY IF EXISTS cs_select_owner_or_admin ON public.client_subscriptions;
CREATE POLICY cs_select_owner_or_admin ON public.client_subscriptions FOR SELECT TO authenticated
  USING (
    public.is_admin_of_barbershop(barbershop_id)
    OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid())
  );

-- Histórico de cobranças: mesma regra de visibilidade da assinatura.
DROP POLICY IF EXISTS sc_select_owner_or_admin ON public.subscription_charges;
CREATE POLICY sc_select_owner_or_admin ON public.subscription_charges FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_subscriptions s
      WHERE s.id = subscription_id
        AND (
          public.is_admin_of_barbershop(s.barbershop_id)
          OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = s.client_id AND c.user_id = auth.uid())
        )
    )
  );

-- Valores usados em client_subscriptions.status:
--   pending | authorized | active | paused | cancelled | payment_failed

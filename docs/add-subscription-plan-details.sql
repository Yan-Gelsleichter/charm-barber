-- =====================================================================
-- VIP BARBER — Descrição do plano + barbeiros inclusos na assinatura
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- Pré-requisito: já ter rodado docs/add-subscription-plans.sql antes.
-- =====================================================================

-- 1) Descrição livre do plano ------------------------------------------
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS description text;

-- 2) Quais barbeiros atendem esse plano ---------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plan_barbers (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id   uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  UNIQUE (plan_id, barber_id)
);
CREATE INDEX IF NOT EXISTS subscription_plan_barbers_plan_idx
  ON public.subscription_plan_barbers (plan_id);

-- 3) GRANTs ---------------------------------------------------------------
GRANT SELECT                 ON public.subscription_plan_barbers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.subscription_plan_barbers TO authenticated;
GRANT ALL                    ON public.subscription_plan_barbers TO service_role;

-- 4) RLS --------------------------------------------------------------------
ALTER TABLE public.subscription_plan_barbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spb_select_public_or_admin ON public.subscription_plan_barbers;
CREATE POLICY spb_select_public_or_admin ON public.subscription_plan_barbers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscription_plans p
      WHERE p.id = plan_id AND (p.active = true OR public.is_admin_of_barbershop(p.barbershop_id))
    )
  );

DROP POLICY IF EXISTS spb_write_admin ON public.subscription_plan_barbers;
CREATE POLICY spb_write_admin ON public.subscription_plan_barbers FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.subscription_plans p WHERE p.id = plan_id AND public.is_admin_of_barbershop(p.barbershop_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.subscription_plans p WHERE p.id = plan_id AND public.is_admin_of_barbershop(p.barbershop_id))
  );

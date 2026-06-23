-- =====================================================================
-- VIP BARBER — Migração aditiva (sem renomear nada)
-- Tabelas existentes: barbers, services, appointments (em inglês)
-- Cole no SQL Editor do Supabase e clique Run. Pode rodar várias vezes.
-- =====================================================================

-- 1) Colunas novas em barbers ----------------------------------------
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS user_id  uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 2) Coluna nova em services -----------------------------------------
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE;

-- 3) Tabela working_hours --------------------------------------------
CREATE TABLE IF NOT EXISTS public.working_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id   uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  UNIQUE (barber_id, weekday)
);

-- 4) Funções helper ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_barber(_barber_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.barbers WHERE id = _barber_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.barbers WHERE user_id = auth.uid() AND is_admin = true);
$$;

-- 5) GRANTs -----------------------------------------------------------
GRANT SELECT                         ON public.barbers       TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE         ON public.barbers       TO authenticated;
GRANT ALL                            ON public.barbers       TO service_role;

GRANT SELECT                         ON public.services      TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE         ON public.services      TO authenticated;
GRANT ALL                            ON public.services      TO service_role;

GRANT SELECT                         ON public.working_hours TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE         ON public.working_hours TO authenticated;
GRANT ALL                            ON public.working_hours TO service_role;

GRANT SELECT, INSERT                 ON public.appointments  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments  TO authenticated;
GRANT ALL                            ON public.appointments  TO service_role;

-- 6) RLS --------------------------------------------------------------
ALTER TABLE public.barbers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barbers_select_all   ON public.barbers;
DROP POLICY IF EXISTS barbers_insert_admin ON public.barbers;
DROP POLICY IF EXISTS barbers_update_own   ON public.barbers;
DROP POLICY IF EXISTS barbers_delete_admin ON public.barbers;
CREATE POLICY barbers_select_all   ON public.barbers FOR SELECT USING (true);
CREATE POLICY barbers_insert_admin ON public.barbers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY barbers_update_own   ON public.barbers FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY barbers_delete_admin ON public.barbers FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS services_select_all  ON public.services;
DROP POLICY IF EXISTS services_write_owner ON public.services;
CREATE POLICY services_select_all  ON public.services FOR SELECT USING (true);
CREATE POLICY services_write_owner ON public.services FOR ALL TO authenticated
  USING (public.is_barber(barber_id)) WITH CHECK (public.is_barber(barber_id));

DROP POLICY IF EXISTS wh_select_all  ON public.working_hours;
DROP POLICY IF EXISTS wh_write_owner ON public.working_hours;
CREATE POLICY wh_select_all  ON public.working_hours FOR SELECT USING (true);
CREATE POLICY wh_write_owner ON public.working_hours FOR ALL TO authenticated
  USING (public.is_barber(barber_id)) WITH CHECK (public.is_barber(barber_id));

DROP POLICY IF EXISTS ap_select_all   ON public.appointments;
DROP POLICY IF EXISTS ap_insert_any   ON public.appointments;
DROP POLICY IF EXISTS ap_update_owner ON public.appointments;
DROP POLICY IF EXISTS ap_delete_owner ON public.appointments;
CREATE POLICY ap_select_all   ON public.appointments FOR SELECT USING (true);
CREATE POLICY ap_insert_any   ON public.appointments FOR INSERT WITH CHECK (true);
CREATE POLICY ap_update_owner ON public.appointments FOR UPDATE TO authenticated
  USING (public.is_barber(barber_id));
CREATE POLICY ap_delete_owner ON public.appointments FOR DELETE TO authenticated
  USING (public.is_barber(barber_id));

-- 7) Primeiro admin ---------------------------------------------------
-- 1. Crie um usuário em Authentication > Users e copie o UID.
-- 2. Rode (substituindo os valores):
--    INSERT INTO public.barbers (user_id, name, is_admin)
--    VALUES ('UID_DO_USUARIO', 'Seu Nome', true);

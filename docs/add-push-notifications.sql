-- =====================================================================
-- VIP BARBER — Notificações push (Firebase Cloud Messaging)
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

-- 1) Tokens de push dos barbeiros (avisos de agendamento novo / lembrete) --
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id  uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  token      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_barber_idx
  ON public.push_subscriptions (barber_id);

GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL                    ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_owner ON public.push_subscriptions;
CREATE POLICY push_subscriptions_owner ON public.push_subscriptions FOR ALL TO authenticated
  USING (public.is_barber(barber_id))
  WITH CHECK (public.is_barber(barber_id));

-- 2) Lembrete do cliente (token capturado no navegador ao agendar) ---------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS push_token text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS barber_reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS appointments_reminder_idx
  ON public.appointments (appointment_time)
  WHERE reminder_sent_at IS NULL OR barber_reminder_sent_at IS NULL;

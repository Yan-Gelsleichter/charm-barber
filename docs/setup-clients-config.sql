-- =========================================================
-- VIP BARBER — Multi-tenant: Configurações + Clientes
-- Rode este bloco no SQL Editor do Supabase (mesmo projeto do app).
-- Seguro para rodar mais de uma vez.
-- =========================================================

-- 1) Colunas de configuração da barbearia em barbers
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS logo_url      text,
  ADD COLUMN IF NOT EXISTS primary_color text;

-- 2) Tabela clients (garantia idempotente das colunas usadas pelo app)
CREATE TABLE IF NOT EXISTS public.clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id  uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text,
  whatsapp   text,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS clients_barber_idx ON public.clients(barber_id);
CREATE INDEX IF NOT EXISTS clients_user_idx   ON public.clients(user_id);
CREATE INDEX IF NOT EXISTS clients_email_idx  ON public.clients(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_admin_all      ON public.clients;
DROP POLICY IF EXISTS clients_owner_select   ON public.clients;
DROP POLICY IF EXISTS clients_owner_update   ON public.clients;

-- Admin dono da barbearia (barbers.is_admin com id = clients.barber_id) faz tudo
CREATE POLICY clients_admin_all ON public.clients
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.id = clients.barber_id
        AND b.user_id = auth.uid()
        AND b.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.id = clients.barber_id
        AND b.user_id = auth.uid()
        AND b.is_admin = true
    )
  );

-- O próprio cliente pode ler / atualizar sua linha
CREATE POLICY clients_owner_select ON public.clients
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY clients_owner_update ON public.clients
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3) Permitir que o cliente logado leia seus agendamentos (por telefone/email do clients)
DROP POLICY IF EXISTS appointments_client_select ON public.appointments;
CREATE POLICY appointments_client_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.barber_id = appointments.barber_id
        AND (
          (c.whatsapp IS NOT NULL AND c.whatsapp = appointments.customer_phone)
          OR (c.name IS NOT NULL AND c.name = appointments.customer_name)
        )
    )
  );

-- 4) Storage bucket público para logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS logos_public_read   ON storage.objects;
DROP POLICY IF EXISTS logos_admin_write   ON storage.objects;
DROP POLICY IF EXISTS logos_admin_update  ON storage.objects;
DROP POLICY IF EXISTS logos_admin_delete  ON storage.objects;

CREATE POLICY logos_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'logos');

CREATE POLICY logos_admin_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'logos'
    AND EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.user_id = auth.uid() AND b.is_admin = true
    )
  );

CREATE POLICY logos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'logos'
    AND EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.user_id = auth.uid() AND b.is_admin = true
    )
  );

CREATE POLICY logos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'logos'
    AND EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.user_id = auth.uid() AND b.is_admin = true
    )
  );

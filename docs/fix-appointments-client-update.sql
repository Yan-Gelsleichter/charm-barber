-- Permite que o cliente logado atualize o próprio agendamento
-- (pagar presencialmente, cancelar, remarcar).
-- Versão à prova de erro: cria a coluna clients.user_id se ela não existir
-- (o erro "column c.user_id does not exist" acontece quando ela falta).
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS clients_user_idx ON public.clients(user_id);

-- Cliente pode INSERIR o próprio agendamento
DROP POLICY IF EXISTS appointments_client_insert ON public.appointments;
CREATE POLICY appointments_client_insert ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Cliente pode LER os agendamentos ligados ao cadastro dele
DROP POLICY IF EXISTS appointments_client_select ON public.appointments;
CREATE POLICY appointments_client_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.barber_id = appointments.barber_id
    )
    OR EXISTS (
      SELECT 1 FROM public.barbers b
      WHERE b.user_id = auth.uid()
        AND (b.id = appointments.barber_id OR b.is_admin = true)
    )
  );

-- Cliente pode ATUALIZAR o próprio agendamento
DROP POLICY IF EXISTS appointments_client_update ON public.appointments;
CREATE POLICY appointments_client_update ON public.appointments
  FOR UPDATE TO authenticated
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
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.barber_id = appointments.barber_id
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;

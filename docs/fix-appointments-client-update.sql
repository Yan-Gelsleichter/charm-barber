-- Permite que o cliente logado atualize o próprio agendamento
-- (escolher pagar presencialmente, cancelar, remarcar).
-- Rode no SQL Editor do Supabase.

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
          OR (c.email IS NOT NULL AND lower(c.email) = lower(coalesce(appointments.email, '')))
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

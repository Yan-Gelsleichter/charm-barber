-- =========================================================
-- Fix: permitir que o cliente logado insira a própria linha
-- na tabela clients ao marcar horário com QUALQUER barbeiro
-- (admin ou não). Rode no SQL Editor do Supabase.
-- =========================================================

DROP POLICY IF EXISTS clients_self_insert ON public.clients;

CREATE POLICY clients_self_insert ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- (opcional) permitir o próprio cliente atualizar a linha dele —
-- já existe clients_owner_update, mantido por segurança:
DROP POLICY IF EXISTS clients_owner_update ON public.clients;
CREATE POLICY clients_owner_update ON public.clients
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

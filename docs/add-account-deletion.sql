-- =====================================================================
-- APP BARBEARIAS — Exclusão de conta (Play Store + LGPD)
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- Pode rodar várias vezes sem problema.
-- =====================================================================

-- Marca a barbearia como encerrada (quando o único admin exclui a própria
-- conta e todas as condições de segurança já foram cumpridas). Sem valor =
-- barbearia ativa normalmente.
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

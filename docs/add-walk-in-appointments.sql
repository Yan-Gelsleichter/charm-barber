-- =====================================================================
-- VIP BARBER — Atendimento avulso (presencial, cadastrado direto pelo
-- admin, sem passar pelo app). Não deve bloquear a agenda de
-- disponibilidade do barbeiro. Migração aditiva.
-- Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.appointments
  add column if not exists is_walk_in boolean not null default false;

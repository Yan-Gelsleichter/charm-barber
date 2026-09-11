-- =====================================================================
-- VIP BARBER — Suporte a múltiplos serviços por agendamento (ex.: corte +
-- barba num único horário), agendamentos "filhos" (serviço extra vinculado
-- a um agendamento existente, resolvido separadamente no Caixa) e a base
-- pra cancelamento (em vez de exclusão) de agendamentos vindos do app.
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.appointments
  add column if not exists service_ids uuid[] not null default '{}',
  add column if not exists duration_minutes_snapshot integer,
  add column if not exists parent_appointment_id uuid references public.appointments(id) on delete set null;

create index if not exists appointments_parent_appointment_id_idx
  on public.appointments (parent_appointment_id) where parent_appointment_id is not null;

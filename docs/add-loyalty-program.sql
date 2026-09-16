-- =====================================================================
-- VIP BARBER — Programa de fidelidade configurável por barbearia.
-- Múltiplos programas por barbearia (genérico ou por serviço/grupo de
-- serviços), com meta de atendimentos e resgate aplicado na hora de
-- marcar um novo horário (não é um botão solto). O progresso é sempre
-- CALCULADO na leitura (nunca um contador gravado) a partir de
-- appointments pagos + com comparecimento confirmado, então nenhuma
-- tabela guarda "pontos" — só os programas e os resgates já usados.
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null,
  scope text not null default 'generic' check (scope in ('generic', 'services')),
  goal integer not null check (goal > 0),
  include_walk_in boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_program_services (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade
);

-- Uma linha por resgate USADO (sempre vinculado a um agendamento novo,
-- criado já como "pago via fidelidade"). Se o agendamento vinculado for
-- cancelado, o cálculo de status ignora essa linha automaticamente — o
-- resgate volta a ficar disponível sem nenhuma escrita extra aqui.
create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  -- Sem "on delete cascade" de propósito: um programa com resgates já
  -- usados não pode ser excluído (o admin precisa desativar em vez de
  -- excluir), mesma trava que já existe pra excluir um plano de
  -- assinatura com assinantes.
  program_id uuid not null references public.loyalty_programs(id),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  customer_phone text not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists covered_by_loyalty_program_id uuid references public.loyalty_programs(id),
  -- "Compareceu" é uma confirmação manual (Caixa ou Agenda), não o
  -- relógio passando — só isso conta ponto de fidelidade, pra um
  -- no-show não valer como atendimento realizado.
  add column if not exists attendance_confirmed boolean not null default false,
  add column if not exists attendance_confirmed_at timestamptz;

create index if not exists loyalty_programs_barbershop_id_idx
  on public.loyalty_programs (barbershop_id);
create index if not exists loyalty_program_services_program_id_idx
  on public.loyalty_program_services (program_id);
create index if not exists loyalty_redemptions_program_phone_idx
  on public.loyalty_redemptions (program_id, customer_phone);

alter table public.loyalty_programs enable row level security;
alter table public.loyalty_program_services enable row level security;
alter table public.loyalty_redemptions enable row level security;

-- Mesmo padrão de RLS já usado em subscription_plans (função helper
-- public.is_admin_of_barbershop, criada em add-subscription-plans.sql):
-- leitura liberada pra quem está ativo (o cliente precisa ver os
-- programas da barbearia onde está agendando) ou pro admin dono;
-- escrita só pro admin da própria barbearia.
drop policy if exists lp_select_active_or_admin on public.loyalty_programs;
create policy lp_select_active_or_admin on public.loyalty_programs for select
  using (active = true or public.is_admin_of_barbershop(barbershop_id));

drop policy if exists lp_write_admin on public.loyalty_programs;
create policy lp_write_admin on public.loyalty_programs for all to authenticated
  using (public.is_admin_of_barbershop(barbershop_id))
  with check (public.is_admin_of_barbershop(barbershop_id));

drop policy if exists lps_select_active_or_admin on public.loyalty_program_services;
create policy lps_select_active_or_admin on public.loyalty_program_services for select
  using (
    exists (
      select 1 from public.loyalty_programs p
      where p.id = program_id and (p.active = true or public.is_admin_of_barbershop(p.barbershop_id))
    )
  );

drop policy if exists lps_write_admin on public.loyalty_program_services;
create policy lps_write_admin on public.loyalty_program_services for all to authenticated
  using (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  )
  with check (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  );

-- loyalty_redemptions só é lida/gravada pelos endpoints de servidor
-- (service role sempre ignora RLS) — sem policy pra authenticated/anon.

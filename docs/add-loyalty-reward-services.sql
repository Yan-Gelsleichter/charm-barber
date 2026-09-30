-- =====================================================================
-- APP BARBEARIAS — Escolher quais serviços valem como o prêmio
-- "atendimento grátis" da fidelidade (opcional, separado dos serviços
-- que contam ponto).
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- Pré-requisito: já ter rodado docs/add-loyalty-program.sql.
-- =====================================================================

-- Sem nenhuma linha aqui pra um programa = comportamento de hoje,
-- preservado (no escopo "Serviços específicos", o prêmio vale pros mesmos
-- serviços que contam ponto; no escopo "Qualquer atendimento", o prêmio
-- vale pra qualquer serviço). Com uma ou mais linhas, só esses serviços
-- (e por tabela, só os barbeiros donos deles) podem ser escolhidos como o
-- atendimento grátis.
create table if not exists public.loyalty_program_reward_services (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  unique (program_id, service_id)
);

create index if not exists loyalty_program_reward_services_program_id_idx
  on public.loyalty_program_reward_services (program_id);

alter table public.loyalty_program_reward_services enable row level security;

-- Mesmo padrão de RLS já usado em loyalty_program_services / loyalty_program_barbers.
drop policy if exists lprs_select_active_or_admin on public.loyalty_program_reward_services;
create policy lprs_select_active_or_admin on public.loyalty_program_reward_services for select
  using (
    exists (
      select 1 from public.loyalty_programs p
      where p.id = program_id and (p.active = true or public.is_admin_of_barbershop(p.barbershop_id))
    )
  );

drop policy if exists lprs_write_admin on public.loyalty_program_reward_services;
create policy lprs_write_admin on public.loyalty_program_reward_services for all to authenticated
  using (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  )
  with check (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  );

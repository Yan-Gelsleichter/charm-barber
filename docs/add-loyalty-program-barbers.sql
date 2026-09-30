-- =====================================================================
-- APP BARBEARIAS — Restringir programa de fidelidade "Qualquer
-- atendimento" a barbeiros específicos (opcional).
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- Pré-requisito: já ter rodado docs/add-loyalty-program.sql.
-- =====================================================================

-- Sem nenhuma linha aqui pra um programa = vale para todos os barbeiros
-- (comportamento de hoje, preservado). Com uma ou mais linhas, só esses
-- barbeiros contam ponto e podem oferecer o resgate.
create table if not exists public.loyalty_program_barbers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete cascade,
  unique (program_id, barber_id)
);

create index if not exists loyalty_program_barbers_program_id_idx
  on public.loyalty_program_barbers (program_id);

alter table public.loyalty_program_barbers enable row level security;

-- Mesmo padrão de RLS já usado em loyalty_program_services.
drop policy if exists lpb_select_active_or_admin on public.loyalty_program_barbers;
create policy lpb_select_active_or_admin on public.loyalty_program_barbers for select
  using (
    exists (
      select 1 from public.loyalty_programs p
      where p.id = program_id and (p.active = true or public.is_admin_of_barbershop(p.barbershop_id))
    )
  );

drop policy if exists lpb_write_admin on public.loyalty_program_barbers;
create policy lpb_write_admin on public.loyalty_program_barbers for all to authenticated
  using (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  )
  with check (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  );

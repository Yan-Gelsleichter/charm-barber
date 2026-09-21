-- =====================================================================
-- APP BARBEARIAS — Prêmio de fidelidade pode ser um produto.
-- Cada programa passa a poder oferecer: atendimento grátis (agendado
-- pelo app, como já é hoje), um ou mais produtos do catálogo (retirada
-- na barbearia), ou os dois — o cliente escolhe na hora de resgatar.
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.loyalty_programs
  add column if not exists allow_service_reward boolean not null default true;

create table if not exists public.loyalty_program_products (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade
);

create index if not exists loyalty_program_products_program_id_idx
  on public.loyalty_program_products (program_id);

-- Resgate de produto: a linha de resgate aponta pro pedido de produto
-- gerado (appointment_id fica nulo). Um resgate de produto é sempre
-- consumido de vez — diferente do resgate de atendimento, não volta
-- sozinho se o pedido for cancelado.
alter table public.loyalty_redemptions
  add column if not exists product_order_id uuid references public.product_orders(id) on delete set null;

alter table public.product_orders
  add column if not exists covered_by_loyalty_program_id uuid references public.loyalty_programs(id);

alter table public.loyalty_program_products enable row level security;

drop policy if exists lpp_select_active_or_admin on public.loyalty_program_products;
create policy lpp_select_active_or_admin on public.loyalty_program_products for select
  using (
    exists (
      select 1 from public.loyalty_programs p
      where p.id = program_id and (p.active = true or public.is_admin_of_barbershop(p.barbershop_id))
    )
  );

drop policy if exists lpp_write_admin on public.loyalty_program_products;
create policy lpp_write_admin on public.loyalty_program_products for all to authenticated
  using (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  )
  with check (
    exists (select 1 from public.loyalty_programs p where p.id = program_id and public.is_admin_of_barbershop(p.barbershop_id))
  );

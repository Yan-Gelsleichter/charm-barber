-- =====================================================================
-- APP BARBEARIAS — Venda de produtos físicos (aba "Produtos").
-- Catálogo por barbearia + pedidos (carrinho com vários produtos e
-- quantidades) + comissão por barbeiro em vendas presenciais lançadas
-- pela Caixa. O dinheiro da venda sempre vai pra conta da própria
-- barbearia no Mercado Pago (nunca split) — a comissão aqui é só um
-- número de controle interno, paga por fora pelo admin.
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  title text not null,
  description text,
  price numeric not null check (price >= 0),
  image_url text,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Um pedido é o carrinho inteiro (pode ter vários produtos diferentes,
-- cada um com sua própria quantidade — ver product_order_items).
create table if not exists public.product_orders (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  -- Soma travada de todos os itens no momento da compra — igual ao
  -- service_price_snapshot somado em appointments multi-serviço.
  total_price numeric not null default 0,
  payment_status text not null default 'pendente',
  payment_method text,
  mp_payment_id text,
  paid_at timestamptz,
  -- Venda presencial lançada pela Caixa (true) vs. compra pelo cliente no
  -- app (false) — só a primeira pode ter barber_id/gerar comissão.
  is_walk_in boolean not null default false,
  barber_id uuid references public.barbers(id) on delete set null,
  fulfilled_at timestamptz,
  push_token text,
  created_at timestamptz not null default now()
);

-- Um item por produto dentro do pedido, com sua própria quantidade.
create table if not exists public.product_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.product_orders(id) on delete cascade,
  -- Sem cascade: um produto com itens de pedido não pode ser excluído (o
  -- admin precisa desativar em vez de excluir), mesma trava já usada em
  -- loyalty_programs/subscription_plans.
  product_id uuid not null references public.products(id),
  product_title text not null,
  product_price numeric not null,
  quantity integer not null default 1 check (quantity > 0)
);

-- Comissão de produto é um campo separado do commission_percent que já
-- existe (esse é só de serviço/split) — um barbeiro pode ter uma % em
-- serviço e outra (ou nenhuma) em produto.
alter table public.barbers
  add column if not exists product_commission_percent numeric not null default 0;

create index if not exists products_barbershop_id_idx
  on public.products (barbershop_id);
create index if not exists product_orders_barbershop_id_idx
  on public.product_orders (barbershop_id);
create index if not exists product_orders_barber_id_idx
  on public.product_orders (barber_id);
create index if not exists product_order_items_order_id_idx
  on public.product_order_items (order_id);

-- Decremento atômico de estoque — um UPDATE só é atômico no Postgres,
-- evitando corrida entre dois pagamentos confirmando ao mesmo tempo
-- (o que não aconteceria se a leitura e a escrita fossem dois passos
-- separados no código do servidor).
create or replace function public.decrement_product_stock(p_product_id uuid, p_qty integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.products
  set stock_quantity = greatest(0, stock_quantity - p_qty)
  where id = p_product_id;
$$;

alter table public.products enable row level security;
alter table public.product_orders enable row level security;
alter table public.product_order_items enable row level security;

-- Mesmo padrão de RLS já usado em subscription_plans/loyalty_programs
-- (função helper public.is_admin_of_barbershop, criada em
-- add-subscription-plans.sql): leitura liberada pra quem está ativo (o
-- cliente precisa ver o catálogo da barbearia onde está comprando) ou
-- pro admin dono; escrita só pro admin da própria barbearia.
drop policy if exists products_select_active_or_admin on public.products;
create policy products_select_active_or_admin on public.products for select
  using (active = true or public.is_admin_of_barbershop(barbershop_id));

drop policy if exists products_write_admin on public.products;
create policy products_write_admin on public.products for all to authenticated
  using (public.is_admin_of_barbershop(barbershop_id))
  with check (public.is_admin_of_barbershop(barbershop_id));

-- Escrita de product_orders/product_order_items é sempre pelos endpoints
-- de servidor (service role ignora RLS). Leitura, porém, precisa ficar
-- aberta: o admin lê o pedido de qualquer barbeiro da própria barbearia,
-- o barbeiro comum lê os próprios (pra comissão), e o CLIENTE lê o
-- status do próprio pedido sem estar logado (tela de confirmação de
-- pagamento e "Meus pedidos") — mesmo padrão já usado em appointments
-- (public.appointments tem "for select using (true)": a segurança contra
-- acesso indevido é o id do pedido ser um UUID não adivinhável, nunca
-- listado publicamente, exatamente como já funciona pra agendamentos).
drop policy if exists product_orders_select_all on public.product_orders;
create policy product_orders_select_all on public.product_orders for select
  using (true);

drop policy if exists product_order_items_select_all on public.product_order_items;
create policy product_order_items_select_all on public.product_order_items for select
  using (true);

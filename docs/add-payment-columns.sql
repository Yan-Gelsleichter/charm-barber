-- Colunas de pagamento PIX (Mercado Pago) na tabela appointments.
-- Rode no SQL Editor do Supabase.

alter table public.appointments
  add column if not exists payment_status text not null default 'pendente',
  add column if not exists payment_method text,
  add column if not exists mp_payment_id text,
  add column if not exists paid_at timestamptz;

create index if not exists appointments_mp_payment_id_idx
  on public.appointments (mp_payment_id);

-- Entrega mudanças de pagamento instantaneamente para a tela de confirmação.
-- O bloco é idempotente e pode ser executado mais de uma vez.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- Checagem pós-configuração: deve retornar exatamente uma linha para
-- public.appointments. Se não retornar, o Realtime não publicará os UPDATEs.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'appointments';

-- Valores usados pelo app em payment_status:
--   pendente | pago | expirado | cancelado | falhou

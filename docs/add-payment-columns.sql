-- Colunas de pagamento PIX (Mercado Pago) na tabela appointments.
-- Rode no SQL Editor do Supabase.

alter table public.appointments
  add column if not exists payment_status text not null default 'pendente',
  add column if not exists payment_method text,
  add column if not exists mp_payment_id text,
  add column if not exists paid_at timestamptz;

create index if not exists appointments_mp_payment_id_idx
  on public.appointments (mp_payment_id);

-- Valores usados pelo app em payment_status:
--   pendente | pago | expirado | cancelado | falhou

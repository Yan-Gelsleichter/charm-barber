-- Idempotência dos webhooks do Mercado Pago.
-- Guarda cada evento já processado para evitar atualizações duplicadas
-- quando o Mercado Pago reenvia a mesma notificação.

create table if not exists public.mp_webhook_events (
  event_id text primary key,
  payment_id text,
  appointment_id uuid,
  status text,
  processed_at timestamptz not null default now()
);

-- Apenas o backend (service role) acessa esta tabela.
grant all on public.mp_webhook_events to service_role;

alter table public.mp_webhook_events enable row level security;

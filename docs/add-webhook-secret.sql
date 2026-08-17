-- Assinatura secreta do Webhook do Mercado Pago por barbearia (multi-tenant).
-- Cada barbearia conectada via OAuth pode ter sua própria "Assinatura secreta"
-- configurada no painel do Mercado Pago. O webhook valida a notificação com a
-- secret da barbearia dona do pagamento e só usa MP_WEBHOOK_SECRET como fallback.

alter table public.barbershops
  add column if not exists mp_webhook_secret text;

alter table public.barbers
  add column if not exists mp_webhook_secret text;

-- Segredos nunca devem ser expostos ao cliente.
revoke select (mp_webhook_secret) on public.barbershops from anon, authenticated;
revoke select (mp_webhook_secret) on public.barbers from anon, authenticated;

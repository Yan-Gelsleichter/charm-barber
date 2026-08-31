-- =====================================================================
-- VIP BARBER — Slug amigável por barbearia (link/QR code de convite)
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

alter table public.barbershops
  add column if not exists slug text;

-- Único quando preenchido — fica nulo até ser gerado (sob demanda, na
-- primeira vez que o admin abre a tela de QR Code), sem travar as
-- barbearias que já existem hoje.
create unique index if not exists barbershops_slug_idx
  on public.barbershops (slug) where slug is not null;

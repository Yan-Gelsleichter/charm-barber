-- Garante que cada usuário só enxergue/altere os próprios cartões.
-- Rode no SQL Editor do Supabase.

alter table public.saved_cards enable row level security;

-- Cartões nunca devem ser legíveis por visitantes não autenticados.
revoke all on public.saved_cards from anon;
grant select, insert, update, delete on public.saved_cards to authenticated;
grant all on public.saved_cards to service_role;

drop policy if exists "own cards select" on public.saved_cards;
create policy "own cards select" on public.saved_cards
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own cards insert" on public.saved_cards;
create policy "own cards insert" on public.saved_cards
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "own cards update" on public.saved_cards;
create policy "own cards update" on public.saved_cards
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own cards delete" on public.saved_cards;
create policy "own cards delete" on public.saved_cards
  for delete to authenticated using (auth.uid() = user_id);

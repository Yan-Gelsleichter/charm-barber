-- Cartão padrão do cliente. Rode no SQL Editor do Supabase.
alter table public.saved_cards add column if not exists is_default boolean not null default false;

create index if not exists saved_cards_default_idx on public.saved_cards (user_id, is_default);

-- Cliente pode atualizar os próprios cartões (nome, validade, padrão).
drop policy if exists "own cards update" on public.saved_cards;
create policy "own cards update" on public.saved_cards
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

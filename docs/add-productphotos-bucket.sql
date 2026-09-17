-- =====================================================================
-- APP BARBEARIAS — Bucket de Storage pra foto de produto.
-- Mesma configuração já usada no bucket "barberlogos" (foto de perfil/
-- logo): público pra leitura (o cliente vê a foto sem precisar estar
-- logado) e só usuários logados podem enviar/substituir arquivos.
-- Cole no SQL Editor do Supabase e clique Run.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('productphotos', 'productphotos', true)
on conflict (id) do nothing;

drop policy if exists "productphotos_public_read" on storage.objects;
create policy "productphotos_public_read" on storage.objects for select
  using (bucket_id = 'productphotos');

drop policy if exists "productphotos_authenticated_upload" on storage.objects;
create policy "productphotos_authenticated_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'productphotos');

drop policy if exists "productphotos_authenticated_update" on storage.objects;
create policy "productphotos_authenticated_update" on storage.objects for update to authenticated
  using (bucket_id = 'productphotos');

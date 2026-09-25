-- =====================================================================
-- APP BARBEARIAS — Imagem de fundo escolhida por cada barbeiro
-- Migração aditiva. Cole no SQL Editor do Supabase e clique Run.
-- Pode rodar várias vezes sem problema.
-- =====================================================================

-- bg_home    : fundo da tela inicial do celular (vazio = imagem padrão do app)
-- bg_tabs    : fundo das demais abas (vazio = cor padrão do app)
-- bg_custom  : imagens próprias que o barbeiro enviou pro carrossel (URLs)
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS bg_home   text,
  ADD COLUMN IF NOT EXISTS bg_tabs   text,
  ADD COLUMN IF NOT EXISTS bg_custom text[] NOT NULL DEFAULT '{}';

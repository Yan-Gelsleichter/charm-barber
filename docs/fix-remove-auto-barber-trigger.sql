-- Corrige o problema em que qualquer novo usuário (inclusive cliente que se
-- cadastra pela tela de criar conta, ou login via Google) era automaticamente
-- cadastrado como barbeiro.
--
-- RODE ESTE SCRIPT UMA VEZ NO SQL EDITOR DO SUPABASE.

-- 1) Remove o trigger e a função que criavam a linha em public.barbers
--    a cada novo usuário em auth.users.
DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 2) Apaga barbeiros criados por engano (Romeu e qualquer outro cliente
--    que virou barbeiro sem ter sido cadastrado pelo painel admin).
--    Ajuste/adicione e-mails conforme necessário.
DELETE FROM public.barbers
 WHERE user_id IN (
   SELECT id FROM auth.users
    WHERE email IN (
      'romeu@exemplo.com'          -- << troque pelo e-mail real do Romeu
      -- , 'outro-cliente@exemplo.com'
    )
 );

-- Para descobrir o e-mail exato cadastrado, rode antes:
--   SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 20;

-- A partir daqui, apenas o fluxo "Cadastrar novo barbeiro" no painel do admin
-- cria registros em public.barbers. Clientes que entram por e-mail/senha ou
-- Google NÃO viram barbeiros automaticamente.

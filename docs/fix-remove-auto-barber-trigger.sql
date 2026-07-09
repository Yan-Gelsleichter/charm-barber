-- Corrige o problema em que qualquer novo usuário (inclusive login via Google)
-- era automaticamente cadastrado como barbeiro.
--
-- Rode este script UMA VEZ no SQL Editor do Supabase.

-- 1) Remove o trigger e a função que criavam a linha em public.barbers
--    a cada novo usuário em auth.users.
DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 2) (Opcional) Apague barbeiros criados por engano.
--    Descomente e ajuste o e-mail conforme necessário:
-- DELETE FROM public.barbers
--  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'yangelsleichter@gmail.com');

-- A partir daqui, apenas o fluxo "Cadastrar novo barbeiro" no painel do admin
-- cria registros em public.barbers. Clientes que entram por e-mail/senha ou
-- Google NÃO viram barbeiros automaticamente.

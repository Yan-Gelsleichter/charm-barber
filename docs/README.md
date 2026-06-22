# VIP BARBER — Setup do banco (Supabase próprio)

> Como você está usando sua **própria instância** do Supabase (não o Lovable Cloud), as migrações precisam ser rodadas **manualmente** por você no SQL Editor do projeto.

## 1) Rode a migração

Cole o conteúdo de [`docs/database-setup.sql`](./database-setup.sql) no **SQL Editor** do seu projeto Supabase e clique em **Run**. Ela é idempotente — pode rodar de novo sem problemas.

A migração faz:

- Renomeia colunas com acento (`serviços` → `servicos`, `duração_minutos` → `duracao_minutos`, `preço` → `preco`, `horário_da_consulta` → `horario_consulta`, `id_do_serviço` → `servico_id`, `nome_do_cliente` → `nome_cliente`, `telefone_do_cliente` → `telefone_cliente`).
- Adiciona `user_id` (FK → `auth.users`) e `is_admin` em `barbeiros`.
- Adiciona `barbeiro_id` em `servicos` (serviços por barbeiro).
- Cria tabela `horarios_trabalho`.
- Funções `is_barbeiro(uuid)` e `is_admin()` (SECURITY DEFINER).
- GRANTs e RLS em todas as tabelas.

## 2) Crie o **primeiro admin**

Como você usa Supabase próprio, o primeiro barbeiro-admin precisa ser criado por você:

1. No Supabase: **Authentication → Users → Add user**. Defina e-mail e senha e confirme.
2. Copie o **UID** do usuário recém-criado.
3. No SQL Editor, rode:

```sql
INSERT INTO public.barbeiros (user_id, nome, is_admin)
VALUES ('COLE_O_UID_AQUI', 'Seu Nome', true);
```

Pronto. Esse usuário entra em `/auth` e a partir do painel **Barbeiros** cadastra os demais.

## 3) Variáveis de ambiente

Já estão em `.env`:

```
VITE_SUPABASE_URL=https://axuvfztbyfmswpcveujo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Pendências conhecidas

- **Lembretes** (email/SMS/WhatsApp): por enquanto, apenas exibimos "próximos agendamentos" no painel. Envio real exige uma integração paga (Resend para email é a mais simples) — me avise quando quiser ativar.
- **Auth Admin API** (criar barbeiro sem auto-confirmar e-mail): o cadastro no painel usa `auth.signUp` com a anon key, então respeita as suas configurações de Auth no Supabase. Se você tiver "Confirm email" ligado, o novo barbeiro vai precisar confirmar antes de entrar — recomendo desligar essa opção em **Authentication → Sign In / Up** se você confia na sua equipe.

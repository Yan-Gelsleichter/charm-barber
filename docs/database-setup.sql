-- =====================================================================
-- VIP BARBER — Migração inicial (v2, defensiva)
-- Cole no SQL Editor do Supabase e clique Run. Pode rodar várias vezes.
-- Cria as tabelas se não existirem, renomeia variantes em inglês/acento,
-- e só aplica RLS depois que tudo estiver no lugar.
-- =====================================================================

-- 0) Renomear tabelas em inglês (se existirem) -------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='barbers')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='barbeiros') THEN
    EXECUTE 'ALTER TABLE public.barbers RENAME TO barbeiros';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='services')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='servicos')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='serviços') THEN
    EXECUTE 'ALTER TABLE public.services RENAME TO servicos';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='serviços') THEN
    EXECUTE 'ALTER TABLE public."serviços" RENAME TO servicos';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agendamentos') THEN
    EXECUTE 'ALTER TABLE public.appointments RENAME TO agendamentos';
  END IF;
END $$;

-- 1) Criar tabelas base se não existirem -------------------------------
CREATE TABLE IF NOT EXISTS public.barbeiros (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  avatar_url  text
);

CREATE TABLE IF NOT EXISTS public.servicos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             text NOT NULL,
  duracao_minutos  integer NOT NULL DEFAULT 30,
  preco            numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.agendamentos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbeiro_id       uuid,
  nome_cliente      text,
  telefone_cliente  text,
  horario_consulta  timestamptz,
  servico_id        uuid,
  status            text
);

-- 2) Renomear colunas com acento (se ainda existirem) ------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='servicos' AND column_name='duração_minutos') THEN
    EXECUTE 'ALTER TABLE public.servicos RENAME COLUMN "duração_minutos" TO duracao_minutos';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='servicos' AND column_name='preço') THEN
    EXECUTE 'ALTER TABLE public.servicos RENAME COLUMN "preço" TO preco';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agendamentos' AND column_name='horário_da_consulta') THEN
    EXECUTE 'ALTER TABLE public.agendamentos RENAME COLUMN "horário_da_consulta" TO horario_consulta';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agendamentos' AND column_name='id_do_serviço') THEN
    EXECUTE 'ALTER TABLE public.agendamentos RENAME COLUMN "id_do_serviço" TO servico_id';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agendamentos' AND column_name='nome_do_cliente') THEN
    EXECUTE 'ALTER TABLE public.agendamentos RENAME COLUMN "nome_do_cliente" TO nome_cliente';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agendamentos' AND column_name='telefone_do_cliente') THEN
    EXECUTE 'ALTER TABLE public.agendamentos RENAME COLUMN "telefone_do_cliente" TO telefone_cliente';
  END IF;
END $$;

-- 3) Garantir colunas adicionais ---------------------------------------
ALTER TABLE public.barbeiros
  ADD COLUMN IF NOT EXISTS user_id    uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_admin   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS barbeiro_id uuid REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS status     text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.agendamentos ALTER COLUMN status SET DEFAULT 'confirmado';
UPDATE public.agendamentos SET status = 'confirmado' WHERE status IS NULL;

-- FKs em agendamentos (só adiciona se ainda não houver) ----------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='agendamentos' AND constraint_name='agendamentos_barbeiro_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.agendamentos
      ADD CONSTRAINT agendamentos_barbeiro_id_fkey
      FOREIGN KEY (barbeiro_id) REFERENCES public.barbeiros(id) ON DELETE CASCADE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='agendamentos' AND constraint_name='agendamentos_servico_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.agendamentos
      ADD CONSTRAINT agendamentos_servico_id_fkey
      FOREIGN KEY (servico_id) REFERENCES public.servicos(id) ON DELETE SET NULL';
  END IF;
END $$;

-- 4) Tabela horarios_trabalho -----------------------------------------
CREATE TABLE IF NOT EXISTS public.horarios_trabalho (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbeiro_id  uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  dia_semana   smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio  time NOT NULL,
  hora_fim     time NOT NULL,
  UNIQUE (barbeiro_id, dia_semana)
);

-- 5) Funções helper ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_barbeiro(_barbeiro_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.barbeiros WHERE id = _barbeiro_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.barbeiros WHERE user_id = auth.uid() AND is_admin = true);
$$;

-- 6) GRANTs ------------------------------------------------------------
GRANT SELECT ON public.barbeiros          TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.barbeiros TO authenticated;
GRANT ALL    ON public.barbeiros          TO service_role;

GRANT SELECT ON public.servicos           TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.servicos  TO authenticated;
GRANT ALL    ON public.servicos           TO service_role;

GRANT SELECT ON public.horarios_trabalho  TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.horarios_trabalho TO authenticated;
GRANT ALL    ON public.horarios_trabalho  TO service_role;

GRANT SELECT, INSERT ON public.agendamentos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agendamentos TO authenticated;
GRANT ALL    ON public.agendamentos       TO service_role;

-- 7) RLS ---------------------------------------------------------------
ALTER TABLE public.barbeiros         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_trabalho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendamentos      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barbeiros_select_all   ON public.barbeiros;
DROP POLICY IF EXISTS barbeiros_insert_admin ON public.barbeiros;
DROP POLICY IF EXISTS barbeiros_update_own   ON public.barbeiros;
DROP POLICY IF EXISTS barbeiros_delete_admin ON public.barbeiros;
CREATE POLICY barbeiros_select_all   ON public.barbeiros FOR SELECT USING (true);
CREATE POLICY barbeiros_insert_admin ON public.barbeiros FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY barbeiros_update_own   ON public.barbeiros FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY barbeiros_delete_admin ON public.barbeiros FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS servicos_select_all  ON public.servicos;
DROP POLICY IF EXISTS servicos_write_owner ON public.servicos;
CREATE POLICY servicos_select_all  ON public.servicos FOR SELECT USING (true);
CREATE POLICY servicos_write_owner ON public.servicos FOR ALL TO authenticated
  USING (public.is_barbeiro(barbeiro_id)) WITH CHECK (public.is_barbeiro(barbeiro_id));

DROP POLICY IF EXISTS horarios_select_all  ON public.horarios_trabalho;
DROP POLICY IF EXISTS horarios_write_owner ON public.horarios_trabalho;
CREATE POLICY horarios_select_all  ON public.horarios_trabalho FOR SELECT USING (true);
CREATE POLICY horarios_write_owner ON public.horarios_trabalho FOR ALL TO authenticated
  USING (public.is_barbeiro(barbeiro_id)) WITH CHECK (public.is_barbeiro(barbeiro_id));

DROP POLICY IF EXISTS ag_select_all   ON public.agendamentos;
DROP POLICY IF EXISTS ag_insert_any   ON public.agendamentos;
DROP POLICY IF EXISTS ag_update_owner ON public.agendamentos;
DROP POLICY IF EXISTS ag_delete_owner ON public.agendamentos;
CREATE POLICY ag_select_all   ON public.agendamentos FOR SELECT USING (true);
CREATE POLICY ag_insert_any   ON public.agendamentos FOR INSERT WITH CHECK (true);
CREATE POLICY ag_update_owner ON public.agendamentos FOR UPDATE TO authenticated
  USING (public.is_barbeiro(barbeiro_id));
CREATE POLICY ag_delete_owner ON public.agendamentos FOR DELETE TO authenticated
  USING (public.is_barbeiro(barbeiro_id));

-- 8) Pós-migração: criar o primeiro admin ------------------------------
-- 1. Crie um usuário em Authentication > Users e copie o UID.
-- 2. Rode (substituindo os valores):
--    INSERT INTO public.barbeiros (user_id, nome, is_admin)
--    VALUES ('UID_DO_USUARIO', 'Seu Nome', true);

export type Barbeiro = {
  id: string;
  nome: string;
  avatar_url: string | null;
  user_id: string | null;
  is_admin: boolean;
  created_at: string;
};

export type Servico = {
  id: string;
  nome: string;
  duracao_minutos: number;
  preco: number;
  barbeiro_id: string | null;
  created_at: string;
};

export type HorarioTrabalho = {
  id: string;
  barbeiro_id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fim: string;
};

export type Agendamento = {
  id: string;
  barbeiro_id: string;
  servico_id: string;
  nome_cliente: string;
  telefone_cliente: string;
  horario_consulta: string;
  status: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      barbeiros: { Row: Barbeiro; Insert: Partial<Barbeiro>; Update: Partial<Barbeiro> };
      servicos: { Row: Servico; Insert: Partial<Servico>; Update: Partial<Servico> };
      horarios_trabalho: {
        Row: HorarioTrabalho;
        Insert: Partial<HorarioTrabalho>;
        Update: Partial<HorarioTrabalho>;
      };
      agendamentos: { Row: Agendamento; Insert: Partial<Agendamento>; Update: Partial<Agendamento> };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};

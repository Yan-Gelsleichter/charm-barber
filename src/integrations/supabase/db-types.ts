export type Barbeiro = {
  id: string;
  nome: string;
  avatar_url: string | null;
  user_id: string | null;
  is_admin: boolean;
  created_at: string;
};
export type BarbeiroInsert = {
  id?: string;
  nome: string;
  avatar_url?: string | null;
  user_id?: string | null;
  is_admin?: boolean;
  created_at?: string;
};

export type Servico = {
  id: string;
  nome: string;
  duracao_minutos: number;
  preco: number;
  barbeiro_id: string | null;
  created_at: string;
};
export type ServicoInsert = {
  id?: string;
  nome: string;
  duracao_minutos: number;
  preco: number;
  barbeiro_id?: string | null;
  created_at?: string;
};

export type HorarioTrabalho = {
  id: string;
  barbeiro_id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fim: string;
};
export type HorarioTrabalhoInsert = {
  id?: string;
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
export type AgendamentoInsert = {
  id?: string;
  barbeiro_id: string;
  servico_id: string;
  nome_cliente: string;
  telefone_cliente: string;
  horario_consulta: string;
  status?: string;
  created_at?: string;
};

type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      barbeiros: Table<Barbeiro, BarbeiroInsert>;
      servicos: Table<Servico, ServicoInsert>;
      horarios_trabalho: Table<HorarioTrabalho, HorarioTrabalhoInsert>;
      agendamentos: Table<Agendamento, AgendamentoInsert>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

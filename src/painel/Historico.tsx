import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Agendamento, Barbeiro, Servico } from "@/integrations/supabase/db-types";
import { brl, fmtDateTime } from "@/lib/format";

export function HistoricoTab({ barbeiro }: { barbeiro: Barbeiro }) {
  const q = useQuery({
    queryKey: ["historico", barbeiro.id],
    queryFn: async () => {
      const now = new Date().toISOString();
      const [a, s] = await Promise.all([
        supabase
          .from("agendamentos")
          .select("*")
          .eq("barbeiro_id", barbeiro.id)
          .lt("horario_consulta", now)
          .order("horario_consulta", { ascending: false })
          .limit(100),
        supabase.from("servicos").select("*").eq("barbeiro_id", barbeiro.id),
      ]);
      if (a.error) throw a.error;
      if (s.error) throw s.error;
      return { ag: a.data as Agendamento[], sv: s.data as Servico[] };
    },
  });

  const svMap = new Map((q.data?.sv ?? []).map((s) => [s.id, s]));

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Atendimentos passados
      </h2>
      {q.data?.ag.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Sem atendimentos no histórico.
        </div>
      ) : (
        <div className="grid gap-2">
          {q.data?.ag.map((a) => {
            const sv = svMap.get(a.servico_id);
            const cancelado = a.status === "cancelado";
            return (
              <div
                key={a.id}
                className={
                  "surface flex items-center justify-between p-4" +
                  (cancelado ? " opacity-60" : "")
                }
              >
                <div>
                  <p className={"font-semibold " + (cancelado ? "line-through" : "")}>
                    {a.nome_cliente}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sv?.nome ?? "Serviço"} · {fmtDateTime(a.horario_consulta)}
                  </p>
                </div>
                {cancelado ? (
                  <span className="text-xs text-destructive">cancelado</span>
                ) : (
                  <span className="brand-text font-bold">{sv ? brl(sv.preco) : "—"}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

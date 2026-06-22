import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, DollarSign, TrendingUp, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Agendamento, Barbeiro, Servico } from "@/integrations/supabase/db-types";
import { brl, fmtTime } from "@/lib/format";

export function DashboardTab({ barbeiro }: { barbeiro: Barbeiro }) {
  const q = useQuery({
    queryKey: ["dash", barbeiro.id],
    queryFn: async () => {
      const monthAgo = new Date();
      monthAgo.setDate(monthAgo.getDate() - 31);
      const [agRes, svRes] = await Promise.all([
        supabase
          .from("agendamentos")
          .select("*")
          .eq("barbeiro_id", barbeiro.id)
          .gte("horario_consulta", monthAgo.toISOString())
          .order("horario_consulta"),
        supabase.from("servicos").select("*").eq("barbeiro_id", barbeiro.id),
      ]);
      if (agRes.error) throw agRes.error;
      if (svRes.error) throw svRes.error;
      return {
        agendamentos: agRes.data as Agendamento[],
        servicos: svRes.data as Servico[],
      };
    },
  });

  const now = new Date();
  const startDay = new Date(now);
  startDay.setHours(0, 0, 0, 0);
  const startWeek = new Date(startDay);
  startWeek.setDate(startWeek.getDate() - startWeek.getDay());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const priceMap = new Map((q.data?.servicos ?? []).map((s) => [s.id, Number(s.preco)]));
  const agendamentos = q.data?.agendamentos ?? [];

  const sum = (from: Date) =>
    agendamentos
      .filter(
        (a) =>
          a.status !== "cancelado" &&
          new Date(a.horario_consulta) >= from &&
          new Date(a.horario_consulta) <= now,
      )
      .reduce((s, a) => s + (priceMap.get(a.servico_id) ?? 0), 0);

  const ganhosDia = sum(startDay);
  const ganhosSemana = sum(startWeek);
  const ganhosMes = sum(startMonth);

  const proximos = agendamentos
    .filter((a) => new Date(a.horario_consulta) >= now && a.status !== "cancelado")
    .slice(0, 5);

  const clientesUnicos = new Set(
    agendamentos.filter((a) => a.status !== "cancelado").map((a) => a.telefone_cliente),
  ).size;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat icon={DollarSign} label="Hoje" value={brl(ganhosDia)} />
        <Stat icon={TrendingUp} label="Esta semana" value={brl(ganhosSemana)} />
        <Stat icon={CalendarCheck} label="Este mês" value={brl(ganhosMes)} />
        <Stat icon={Users} label="Clientes (30d)" value={String(clientesUnicos)} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Próximos agendamentos
        </h2>
        {proximos.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Sem agendamentos futuros.
          </div>
        ) : (
          <div className="grid gap-2">
            {proximos.map((a) => {
              const sv = q.data?.servicos.find((s) => s.id === a.servico_id);
              return (
                <div key={a.id} className="surface flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{a.nome_cliente}</p>
                    <p className="text-xs text-muted-foreground">
                      {sv?.nome ?? "Serviço"} ·{" "}
                      {new Date(a.horario_consulta).toLocaleDateString("pt-BR")} ·{" "}
                      {fmtTime(a.horario_consulta)}
                    </p>
                  </div>
                  <span className="brand-text font-bold">
                    {sv ? brl(sv.preco) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" /> {label}
      </div>
      <p className="mt-2 text-xl font-bold sm:text-2xl">{value}</p>
    </div>
  );
}

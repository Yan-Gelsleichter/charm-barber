import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { brl } from "@/lib/format";
import { filterActiveAppointments, isCancellationMarker } from "@/lib/availability";

type Periodo = "hoje" | "semana" | "mes" | "ano";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mês" },
  { key: "ano", label: "Este ano" },
];

function inicioDoPeriodo(p: Periodo): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "semana") d.setDate(d.getDate() - d.getDay());
  else if (p === "mes") d.setDate(1);
  else if (p === "ano") d.setMonth(0, 1);
  return d;
}

export function FaturamentoTab({ barber }: { barber: Barber }) {
  const shopId = barber.barbershop_id ?? null;

  const q = useQuery({
    queryKey: ["faturamento", shopId ?? barber.id],
    queryFn: async () => {
      let barbersQuery = supabase.from("barbers").select("*");
      barbersQuery = shopId
        ? barbersQuery.eq("barbershop_id", shopId)
        : barbersQuery.eq("id", barber.id);
      const { data: bs, error: be } = await barbersQuery;
      if (be) throw be;
      const barbeiros = (bs ?? []) as Barber[];
      const ids = barbeiros.map((b) => b.id);
      if (ids.length === 0) return { barbeiros, ag: [] as Appointment[], sv: [] as Service[] };

      const inicioAno = inicioDoPeriodo("ano").toISOString();
      const agora = new Date().toISOString();
      const [a, s] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .in("barber_id", ids)
          .gte("appointment_time", inicioAno)
          .lte("appointment_time", agora)
          .order("appointment_time", { ascending: false }),
        supabase.from("services").select("*").in("barber_id", ids),
      ]);
      if (a.error) throw a.error;
      if (s.error) throw s.error;
      return { barbeiros, ag: a.data as Appointment[], sv: s.data as Service[] };
    },
  });

  const precos = useMemo(
    () => new Map((q.data?.sv ?? []).map((s) => [s.id, Number(s.price) || 0])),
    [q.data?.sv],
  );

  const atendidos = useMemo(
    () =>
      filterActiveAppointments(q.data?.ag ?? []).filter(
        (a) =>
          !isCancellationMarker(a) && (a.status || "").trim().toLowerCase() !== "cancelado",
      ),
    [q.data?.ag],
  );

  const totais = useMemo(() => {
    const t: Record<Periodo, { valor: number; qtd: number }> = {
      hoje: { valor: 0, qtd: 0 },
      semana: { valor: 0, qtd: 0 },
      mes: { valor: 0, qtd: 0 },
      ano: { valor: 0, qtd: 0 },
    };
    for (const p of PERIODOS) {
      const ini = inicioDoPeriodo(p.key).getTime();
      for (const a of atendidos) {
        if (new Date(a.appointment_time).getTime() >= ini) {
          t[p.key].valor += precos.get(a.service_id) ?? 0;
          t[p.key].qtd += 1;
        }
      }
    }
    return t;
  }, [atendidos, precos]);

  const ranking = useMemo(() => {
    const iniMes = inicioDoPeriodo("mes").getTime();
    const map = new Map<string, { mes: number; ano: number; qtdMes: number; qtdAno: number }>();
    for (const b of q.data?.barbeiros ?? []) {
      map.set(b.id, { mes: 0, ano: 0, qtdMes: 0, qtdAno: 0 });
    }
    for (const a of atendidos) {
      const row = map.get(a.barber_id);
      if (!row) continue;
      const v = precos.get(a.service_id) ?? 0;
      row.ano += v;
      row.qtdAno += 1;
      if (new Date(a.appointment_time).getTime() >= iniMes) {
        row.mes += v;
        row.qtdMes += 1;
      }
    }
    return (q.data?.barbeiros ?? [])
      .map((b) => ({ barbeiro: b, ...map.get(b.id)! }))
      .sort((x, y) => y.mes - x.mes || y.ano - x.ano);
  }, [q.data?.barbeiros, atendidos, precos]);

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="surface p-6 text-center text-sm text-destructive">
        Erro ao carregar faturamento: {(q.error as Error).message}
      </div>
    );
  }

  const maior = ranking[0]?.mes ?? 0;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Faturamento da barbearia
      </h2>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PERIODOS.map((p) => (
          <div key={p.key} className="surface flex flex-col gap-1 p-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {p.label}
            </span>
            <span className="brand-text text-xl font-bold">{brl(totais[p.key].valor)}</span>
            <span className="text-[10px] text-muted-foreground">
              {totais[p.key].qtd} atendimento{totais[p.key].qtd === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <Trophy className="size-4" /> Ranking do mês
        </h3>

        {ranking.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum barbeiro cadastrado.
          </div>
        ) : (
          <div className="grid gap-2">
            {ranking.map((r, i) => (
              <div
                key={r.barbeiro.id}
                className="surface grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3"
              >
                <span className="brand-text w-6 text-center text-base font-bold">{i + 1}º</span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.barbeiro.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.qtdMes} no mês · {brl(r.ano)} no ano ({r.qtdAno})
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="brand-gradient h-full rounded-full"
                      style={{ width: `${maior > 0 ? Math.round((r.mes / maior) * 100) : 0}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold">{brl(r.mes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

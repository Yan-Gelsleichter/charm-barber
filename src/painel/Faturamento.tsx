import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { brl, fmtDateTime } from "@/lib/format";
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

interface BarberStats {
  valor: number;
  qtd: number;
}

interface RankingPeriod {
  key: Periodo;
  title: string;
  sublabel: string;
}

const RANKINGS: RankingPeriod[] = [
  { key: "hoje", title: "Ranking do dia", sublabel: "atend. no dia" },
  { key: "semana", title: "Ranking da semana", sublabel: "atend. na semana" },
  { key: "mes", title: "Ranking do mês", sublabel: "atend. no mês" },
  { key: "ano", title: "Ranking do ano", sublabel: "atend. no ano" },
];

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

  const statsPorBarbeiro = useMemo(() => {
    const map = new Map<string, Record<Periodo, BarberStats>>();
    for (const b of q.data?.barbeiros ?? []) {
      map.set(b.id, {
        hoje: { valor: 0, qtd: 0 },
        semana: { valor: 0, qtd: 0 },
        mes: { valor: 0, qtd: 0 },
        ano: { valor: 0, qtd: 0 },
      });
    }
    for (const a of atendidos) {
      const row = map.get(a.barber_id);
      if (!row) continue;
      const v = precos.get(a.service_id) ?? 0;
      const t = new Date(a.appointment_time).getTime();
      for (const p of PERIODOS) {
        if (t >= inicioDoPeriodo(p.key).getTime()) {
          row[p.key].valor += v;
          row[p.key].qtd += 1;
        }
      }
    }
    return map;
  }, [q.data?.barbeiros, atendidos, precos]);

  const rankings = useMemo(() => {
    const base = (q.data?.barbeiros ?? []).map((b) => ({
      barbeiro: b,
      stats: statsPorBarbeiro.get(b.id)!,
    }));
    return {
      hoje: [...base].sort((x, y) => y.stats.hoje.valor - x.stats.hoje.valor || y.stats.hoje.qtd - x.stats.hoje.qtd),
      semana: [...base].sort((x, y) => y.stats.semana.valor - x.stats.semana.valor || y.stats.semana.qtd - x.stats.semana.qtd),
      mes: [...base].sort((x, y) => y.stats.mes.valor - x.stats.mes.valor || y.stats.mes.qtd - x.stats.mes.qtd),
      ano: [...base].sort((x, y) => y.stats.ano.valor - x.stats.ano.valor || y.stats.ano.qtd - x.stats.ano.qtd),
    };
  }, [q.data?.barbeiros, statsPorBarbeiro]);

  const [detalhe, setDetalhe] = useState<{ barbeiro: Barber; periodo: RankingPeriod } | null>(null);
  const [exportando, setExportando] = useState(false);

  const servicosMap = useMemo(
    () => new Map((q.data?.sv ?? []).map((s) => [s.id, s])),
    [q.data?.sv],
  );

  const detalheItens = useMemo(() => {
    if (!detalhe) return [];
    const ini = inicioDoPeriodo(detalhe.periodo.key).getTime();
    return atendidos
      .filter(
        (a) =>
          a.barber_id === detalhe.barbeiro.id &&
          new Date(a.appointment_time).getTime() >= ini,
      )
      .sort(
        (a, b) => new Date(b.appointment_time).getTime() - new Date(a.appointment_time).getTime(),
      );
  }, [detalhe, atendidos]);

  const detalheTotal = useMemo(
    () => detalheItens.reduce((sum, a) => sum + (precos.get(a.service_id) ?? 0), 0),
    [detalheItens, precos],
  );

  async function exportarPdf() {
    if (!detalhe) return;
    setExportando(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF();
      const titulo = barber.business_name?.trim() || "Barbearia";

      doc.setFontSize(16);
      doc.text(titulo, 14, 18);
      doc.setFontSize(12);
      doc.text(`${detalhe.periodo.title} — ${detalhe.barbeiro.name}`, 14, 26);
      doc.setFontSize(10);
      doc.text(`Emitido em ${fmtDateTime(new Date())}`, 14, 32);

      autoTable(doc, {
        startY: 38,
        head: [["Cliente", "Serviço", "Data/Hora", "Valor"]],
        body: detalheItens.map((a) => [
          a.customer_name,
          servicosMap.get(a.service_id)?.name ?? "Serviço",
          fmtDateTime(a.appointment_time),
          brl(precos.get(a.service_id) ?? 0),
        ]),
        foot: [
          [
            `${detalheItens.length} atendimento${detalheItens.length === 1 ? "" : "s"}`,
            "",
            "Total",
            brl(detalheTotal),
          ],
        ],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 30, 30] },
        footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      });

      const slug = detalhe.barbeiro.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      doc.save(`faturamento-${slug}-${detalhe.periodo.key}.pdf`);
    } finally {
      setExportando(false);
    }
  }



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

      <div className="space-y-4">
        {RANKINGS.map((rk) => {
          const list = rankings[rk.key];
          const maior = list[0]?.stats[rk.key].valor ?? 0;
          return (
            <div key={rk.key} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <Trophy className="size-4" /> {rk.title}
              </h3>

              {list.length === 0 ? (
                <div className="surface p-6 text-center text-sm text-muted-foreground">
                  Nenhum barbeiro cadastrado.
                </div>
              ) : (
                <div className="grid gap-2">
                  {list.map((r, i) => {
                    const s = r.stats[rk.key];
                    return (
                      <button
                        key={r.barbeiro.id}
                        type="button"
                        onClick={() => setDetalhe({ barbeiro: r.barbeiro, periodo: rk })}
                        className="surface grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left transition-colors hover:border-primary"
                      >
                        <span className="brand-text w-6 text-center text-base font-bold">
                          {i + 1}º
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.barbeiro.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.qtd} {rk.sublabel}
                          </p>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                            <div
                              className="brand-gradient h-full rounded-full"
                              style={{ width: `${maior > 0 ? Math.round((s.valor / maior) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">{brl(s.valor)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!detalhe} onOpenChange={(open) => !open && setDetalhe(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate">{detalhe?.barbeiro.name}</DialogTitle>
            <DialogDescription>
              {detalhe?.periodo.title} · {detalheItens.length} atendimento
              {detalheItens.length === 1 ? "" : "s"} · {brl(detalheTotal)}
            </DialogDescription>
          </DialogHeader>

          {detalheItens.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportarPdf}
              disabled={exportando}
              className="w-full"
            >
              {exportando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Exportar PDF
            </Button>
          )}



          {detalheItens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum atendimento neste período.
            </p>
          ) : (
            <div className="grid gap-2">
              {detalheItens.map((a) => (
                <div
                  key={a.id}
                  className="surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.customer_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {servicosMap.get(a.service_id)?.name ?? "Serviço"} ·{" "}
                      {fmtDateTime(a.appointment_time)}
                    </p>
                  </div>
                  <span className="brand-text shrink-0 text-sm font-semibold">
                    {brl(precos.get(a.service_id) ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

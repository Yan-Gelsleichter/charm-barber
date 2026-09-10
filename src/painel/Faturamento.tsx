import { useMemo, useState } from "react";
import { Download, Loader2, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentBadge } from "@/components/PaymentBadge";
import type { Barber } from "@/integrations/supabase/db-types";
import { brl, fmtDateTime } from "@/lib/format";
import { brazilDayBounds } from "@/lib/timezone";
import { useFaturamentoTotais, ZERO_STATS, type BarberStats, type Periodo } from "@/hooks/use-faturamento-totais";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mês" },
  { key: "ano", label: "Este ano" },
];

function parseInicio(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return brazilDayBounds(y, m - 1, d).start.getTime();
}

function parseFim(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return brazilDayBounds(y, m - 1, d).end.getTime();
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

const CUSTOM_RANKING: RankingPeriod = {
  key: "custom",
  title: "Ranking do período selecionado",
  sublabel: "atend. no período",
};

export function FaturamentoTab({ barber }: { barber: Barber }) {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const customIni = parseInicio(de);
  const customFim = parseFim(ate);
  const customAtivo = customIni != null && customFim != null && customIni <= customFim;

  const {
    isLoading,
    error,
    barbeiros,
    servicosMap,
    atendidos,
    precoDe,
    faixas,
    totais,
    statsPorBarbeiro,
  } = useFaturamentoTotais(barber, customAtivo ? { ini: customIni!, fim: customFim! } : null);

  const rankings = useMemo(() => {
    const base = barbeiros.map((b) => ({
      barbeiro: b,
      stats: statsPorBarbeiro.get(b.id) ?? ZERO_STATS(),
    }));
    const ordenar = (k: Periodo) =>
      [...base].sort((x, y) => y.stats[k].valor - x.stats[k].valor || y.stats[k].qtd - x.stats[k].qtd);
    return {
      hoje: ordenar("hoje"),
      semana: ordenar("semana"),
      mes: ordenar("mes"),
      ano: ordenar("ano"),
      custom: ordenar("custom"),
    } as Record<Periodo, { barbeiro: Barber; stats: Record<Periodo, BarberStats> }[]>;
  }, [barbeiros, statsPorBarbeiro]);

  const [detalhe, setDetalhe] = useState<{ barbeiro: Barber; periodo: RankingPeriod } | null>(null);
  const [exportando, setExportando] = useState(false);

  const detalheItens = useMemo(() => {
    if (!detalhe) return [];
    const fx = faixas[detalhe.periodo.key];
    if (!fx) return [];
    return atendidos
      .filter((a) => {
        if (a.barber_id !== detalhe.barbeiro.id) return false;
        const t = new Date(a.appointment_time).getTime();
        return t >= fx.ini && t <= fx.fim;
      })
      .sort(
        (a, b) => new Date(b.appointment_time).getTime() - new Date(a.appointment_time).getTime(),
      );
  }, [detalhe, atendidos, faixas]);

  const detalheTotal = useMemo(
    () => detalheItens.reduce((sum, a) => sum + precoDe(a), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detalheItens],
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
          brl(precoDe(a)),
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

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface p-6 text-center text-sm text-destructive">
        Erro ao carregar faturamento: {error.message}
      </div>
    );
  }

  const listasRanking: RankingPeriod[] = customAtivo ? [CUSTOM_RANKING, ...RANKINGS] : RANKINGS;

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

      <div className="surface space-y-3 p-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Período personalizado
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 space-y-1 overflow-hidden">
            <Label htmlFor="fat-de" className="text-[11px] text-muted-foreground">
              De
            </Label>
            <Input
              id="fat-de"
              type="date"
              value={de}
              max={ate || undefined}
              onChange={(e) => setDe(e.target.value)}
              className="h-10 w-full min-w-0 px-2 text-sm"
            />
          </div>
          <div className="min-w-0 space-y-1 overflow-hidden">
            <Label htmlFor="fat-ate" className="text-[11px] text-muted-foreground">
              Até
            </Label>
            <Input
              id="fat-ate"
              type="date"
              value={ate}
              min={de || undefined}
              onChange={(e) => setAte(e.target.value)}
              className="h-10 w-full min-w-0 px-2 text-sm"
            />
          </div>
        </div>

        {customAtivo ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <p className="brand-text text-xl font-bold">{brl(totais.custom.valor)}</p>
              <p className="text-[11px] text-muted-foreground">
                {totais.custom.qtd} atendimento{totais.custom.qtd === 1 ? "" : "s"} no período
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDe("");
                setAte("");
              }}
            >
              Limpar
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Selecione a data inicial e final para ver o faturamento do período.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {listasRanking.map((rk) => {
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
                <div className="grid grid-cols-1 gap-2">
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
            <div className="grid grid-cols-1 gap-2">
              {detalheItens.map((a) => (
                <div
                  key={a.id}
                  className="surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium">{a.customer_name}</p>
                      <PaymentBadge status={a.payment_status} compact />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {servicosMap.get(a.service_id)?.name ?? "Serviço"} ·{" "}
                      {fmtDateTime(a.appointment_time)}
                    </p>
                  </div>
                  <span className="brand-text shrink-0 text-sm font-semibold">
                    {brl(precoDe(a))}
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

import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Appointment, Barber } from "@/integrations/supabase/db-types";
import { brl, fmtDate, fmtDateTime } from "@/lib/format";
import { brazilStartOfWeek, brazilStartOfMonth, brazilDayBounds } from "@/lib/timezone";
import { usePayoutMode } from "@/hooks/use-payout-mode";
import { useFaturamentoTotais } from "@/hooks/use-faturamento-totais";
import { cn } from "@/lib/utils";

type PeriodoRepasse = "semana" | "mes" | "custom";

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

interface RepasseRow {
  barbeiro: Barber;
  online: number;
  presencial: number;
  avulso: number;
  bruto: number;
  liquido: number;
}

export function CaixaRelatorioRepasse({ barber }: { barber: Barber }) {
  const [periodo, setPeriodo] = useState<PeriodoRepasse>("semana");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [aplicarComissao, setAplicarComissao] = useState(true);
  const [exportando, setExportando] = useState(false);

  const { data: payoutMode } = usePayoutMode(barber.barbershop_id ?? null);
  const contaUnica = payoutMode !== "split";

  const agora = Date.now();
  const customIni = parseInicio(de);
  const customFim = parseFim(ate);
  const customPronto = customIni != null && customFim != null && customIni <= customFim;

  const range = useMemo(() => {
    if (periodo === "semana") return { ini: brazilStartOfWeek().getTime(), fim: agora };
    if (periodo === "mes") return { ini: brazilStartOfMonth().getTime(), fim: agora };
    if (customPronto) return { ini: customIni!, fim: customFim! };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, customPronto, customIni, customFim]);

  const totaisHook = useFaturamentoTotais(barber, range);

  const itensDoPeriodo = useMemo(() => {
    if (!range) return [];
    return totaisHook.atendidos.filter((a) => {
      const t = new Date(a.appointment_time).getTime();
      return t >= range.ini && t <= range.fim && a.payment_status === "pago";
    });
  }, [totaisHook.atendidos, range]);

  const categoriaDe = (a: Appointment): "online" | "presencial" | "avulso" => {
    if (a.is_walk_in) return "avulso";
    return a.mp_payment_id ? "online" : "presencial";
  };

  const linhas = useMemo(() => {
    const porBarbeiro = new Map<string, RepasseRow>();
    for (const b of totaisHook.barbeiros) {
      porBarbeiro.set(b.id, {
        barbeiro: b,
        online: 0,
        presencial: 0,
        avulso: 0,
        bruto: 0,
        liquido: 0,
      });
    }
    for (const a of itensDoPeriodo) {
      const row = porBarbeiro.get(a.barber_id);
      if (!row) continue;
      const valor = totaisHook.precoDe(a);
      const cat = categoriaDe(a);
      if (cat === "online") row.online += valor;
      else if (cat === "presencial") row.presencial += valor;
      else row.avulso += valor;
      row.bruto += valor;
    }
    const rows: RepasseRow[] = [];
    for (const row of porBarbeiro.values()) {
      const baseRepasse = row.presencial + row.avulso + (contaUnica ? row.online : 0);
      const pct = Number(row.barbeiro.commission_percent) || 0;
      row.liquido = (baseRepasse * pct) / 100;
      rows.push(row);
    }
    return rows.sort((x, y) => y.bruto - x.bruto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itensDoPeriodo, totaisHook.barbeiros, contaUnica]);

  const totalGeral = useMemo(
    () =>
      linhas.reduce(
        (acc, r) => ({
          online: acc.online + r.online,
          presencial: acc.presencial + r.presencial,
          avulso: acc.avulso + r.avulso,
          bruto: acc.bruto + r.bruto,
          liquido: acc.liquido + r.liquido,
        }),
        { online: 0, presencial: 0, avulso: 0, bruto: 0, liquido: 0 },
      ),
    [linhas],
  );

  async function exportarPdf() {
    if (!range) return;
    setExportando(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF();
      const titulo = barber.business_name?.trim() || "Barbearia";
      const periodoLabel = `${fmtDate(new Date(range.ini))} a ${fmtDate(new Date(range.fim))}`;

      doc.setFontSize(16);
      doc.text(titulo, 14, 18);
      doc.setFontSize(12);
      doc.text(`Relatório de repasse — ${periodoLabel}`, 14, 26);
      doc.setFontSize(10);
      doc.text(`Emitido em ${fmtDateTime(new Date())}`, 14, 32);

      const head = aplicarComissao
        ? [["Barbeiro", "Online", "Presencial", "Avulso", "Bruto", "Comissão", "Líquido"]]
        : [["Barbeiro", "Online", "Presencial", "Avulso", "Bruto"]];
      const body = linhas.map((r) =>
        aplicarComissao
          ? [
              r.barbeiro.name,
              brl(r.online),
              brl(r.presencial),
              brl(r.avulso),
              brl(r.bruto),
              `${Number(r.barbeiro.commission_percent) || 0}%`,
              brl(r.liquido),
            ]
          : [r.barbeiro.name, brl(r.online), brl(r.presencial), brl(r.avulso), brl(r.bruto)],
      );
      const foot = aplicarComissao
        ? [
            [
              "Total",
              brl(totalGeral.online),
              brl(totalGeral.presencial),
              brl(totalGeral.avulso),
              brl(totalGeral.bruto),
              "",
              brl(totalGeral.liquido),
            ],
          ]
        : [
            [
              "Total",
              brl(totalGeral.online),
              brl(totalGeral.presencial),
              brl(totalGeral.avulso),
              brl(totalGeral.bruto),
            ],
          ];

      autoTable(doc, {
        startY: 38,
        head,
        body,
        foot,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 30, 30] },
        footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      });

      doc.save(`repasse-${periodo}.pdf`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "semana", label: "Semanal" },
            { id: "mes", label: "Mensal" },
            { id: "custom", label: "Personalizado" },
          ] as { id: PeriodoRepasse; label: string }[]
        ).map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant={periodo === p.id ? "hero" : "outline"}
            onClick={() => setPeriodo(p.id)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {periodo === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="rep-de" className="text-[11px] text-muted-foreground">
              De
            </Label>
            <Input
              id="rep-de"
              type="date"
              value={de}
              max={ate || undefined}
              onChange={(e) => setDe(e.target.value)}
              className="h-10 w-full px-2 text-sm"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="rep-ate" className="text-[11px] text-muted-foreground">
              Até
            </Label>
            <Input
              id="rep-ate"
              type="date"
              value={ate}
              min={de || undefined}
              onChange={(e) => setAte(e.target.value)}
              className="h-10 w-full px-2 text-sm"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
        <div>
          <p className="text-sm font-medium">Aplicar comissão</p>
          <p className="text-xs text-muted-foreground">
            {contaUnica
              ? "Conta única: pagamentos online entram no repasse."
              : "Split: pagamentos online já caem direto na conta do barbeiro (só informativo aqui)."}
          </p>
        </div>
        <Switch checked={aplicarComissao} onCheckedChange={setAplicarComissao} />
      </div>

      {!range ? (
        <p className="text-xs text-muted-foreground">
          Selecione a data inicial e final para ver o relatório do período.
        </p>
      ) : totaisHook.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : linhas.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Nenhum barbeiro cadastrado.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Barbeiro</th>
                  <th className="py-2 text-right">Online</th>
                  <th className="py-2 text-right">Presencial</th>
                  <th className="py-2 text-right">Avulso</th>
                  <th className="py-2 text-right">Bruto</th>
                  {aplicarComissao && (
                    <>
                      <th className="py-2 text-right">%</th>
                      <th className="py-2 text-right">Líquido</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => (
                  <tr key={r.barbeiro.id} className="border-t border-border">
                    <td className="py-2 font-medium">{r.barbeiro.name}</td>
                    <td className="py-2 text-right">{brl(r.online)}</td>
                    <td className="py-2 text-right">{brl(r.presencial)}</td>
                    <td className="py-2 text-right">{brl(r.avulso)}</td>
                    <td className="py-2 text-right font-semibold">{brl(r.bruto)}</td>
                    {aplicarComissao && (
                      <>
                        <td className="py-2 text-right text-muted-foreground">
                          {Number(r.barbeiro.commission_percent) || 0}%
                        </td>
                        <td className="brand-text py-2 text-right font-semibold">{brl(r.liquido)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={cn("border-t-2 border-border font-semibold")}>
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right">{brl(totalGeral.online)}</td>
                  <td className="py-2 text-right">{brl(totalGeral.presencial)}</td>
                  <td className="py-2 text-right">{brl(totalGeral.avulso)}</td>
                  <td className="py-2 text-right">{brl(totalGeral.bruto)}</td>
                  {aplicarComissao && (
                    <>
                      <td className="py-2" />
                      <td className="brand-text py-2 text-right">{brl(totalGeral.liquido)}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportarPdf}
            disabled={exportando}
            className="w-full"
          >
            {exportando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Exportar PDF
          </Button>
        </>
      )}
    </div>
  );
}

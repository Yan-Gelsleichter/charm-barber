import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProducaoAssinantes } from "@/hooks/use-producao-assinantes";
import { brl, fmtDateTime } from "@/lib/format";

type Period = "week" | "month";

/** Produção de assinantes por barbeiro, com o repasse — aberto pelo botão da aba Planos (admin). */
export function ProducaoDialog({
  barber,
  open,
  onOpenChange,
}: {
  barber: Barber;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const shopId = barber.barbershop_id ?? null;
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [exportando, setExportando] = useState(false);

  const { start, end, label } = useMemo(() => {
    if (period === "week") {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      const e = endOfWeek(anchor, { weekStartsOn: 1 });
      return { start: s, end: e, label: `${format(s, "dd/MM")} – ${format(e, "dd/MM")}` };
    }
    const s = startOfMonth(anchor);
    const e = endOfMonth(anchor);
    return { start: s, end: e, label: format(s, "MMMM 'de' yyyy", { locale: ptBR }) };
  }, [period, anchor]);

  function goPrev() {
    setAnchor((d) => (period === "week" ? addWeeks(d, -1) : addMonths(d, -1)));
  }
  function goNext() {
    setAnchor((d) => (period === "week" ? addWeeks(d, 1) : addMonths(d, 1)));
  }

  const prod = useProducaoAssinantes({ shopId, start, end, enabled: open });
  const { rows, atendimentos, loading } = prod;

  async function exportarPdf() {
    setExportando(true);
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF();
      const titulo = barber.business_name?.trim() || "Barbearia";
      const periodoLabel =
        period === "week"
          ? `${format(start, "dd/MM/yyyy")} a ${format(end, "dd/MM/yyyy")}`
          : format(start, "MMMM 'de' yyyy", { locale: ptBR });

      doc.setFontSize(16);
      doc.text(titulo, 14, 18);
      doc.setFontSize(12);
      doc.text(`Produção por barbeiros (clientes assinantes) — ${periodoLabel}`, 14, 26);
      doc.setFontSize(10);
      doc.text(`Emitido em ${fmtDateTime(new Date())}`, 14, 32);

      autoTable(doc, {
        startY: 38,
        head: [["Barbeiro", "Atendimentos", "Total (referência)", "Repasse"]],
        body: rows.map((r) => [r.name, String(r.count), brl(r.total), brl(r.comissao)]),
        foot: [["Total", String(prod.totalCount), brl(prod.totalValor), brl(prod.totalComissao)]],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 30, 30] },
        footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      });

      const detalhes = [...atendimentos]
        .sort((x, y) => {
          const bx = prod.barberNameById.get(x.barber_id) ?? "";
          const by = prod.barberNameById.get(y.barber_id) ?? "";
          return bx.localeCompare(by) || x.appointment_time.localeCompare(y.appointment_time);
        })
        .map((a) => {
          const planId = prod.planOf(a);
          return [
            prod.barberNameById.get(a.barber_id) ?? "Barbeiro",
            fmtDateTime(new Date(a.appointment_time)),
            a.customer_name,
            (a.service_ids?.length ? a.service_ids : [a.service_id])
              .map((id) => prod.serviceById.get(id)?.name ?? "Serviço")
              .join(" + "),
            (planId && prod.planNameById.get(planId)) || "—",
            brl(prod.priceOf(a)),
            `${prod.percentOf(a)}% = ${brl(prod.comissaoOf(a))}`,
          ];
        });

      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60;
      doc.setFontSize(12);
      doc.text("Todos os atendimentos do período", 14, finalY + 12);
      autoTable(doc, {
        startY: finalY + 16,
        head: [["Barbeiro", "Data e hora", "Cliente", "Serviço", "Plano", "Valor", "Repasse"]],
        body: detalhes,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 30, 30] },
      });

      const nomeArquivo = period === "week" ? "producao-semanal" : "producao-mensal";
      doc.save(`${nomeArquivo}.pdf`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto md:max-w-xl">
        <DialogHeader>
          <DialogTitle>Produção por barbeiros</DialogTitle>
          <DialogDescription>
            Atendimentos de clientes assinantes por barbeiro e o repasse de cada um, conforme a porcentagem
            definida em cada plano.
          </DialogDescription>
        </DialogHeader>

        <div className="surface flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="flex items-center gap-1">
            <Button variant={period === "week" ? "hero" : "ghost"} size="sm" onClick={() => setPeriod("week")}>
              Semana
            </Button>
            <Button variant={period === "month" ? "hero" : "ghost"} size="sm" onClick={() => setPeriod("month")}>
              Mês
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={goPrev}>
              <ChevronLeft />
            </Button>
            <span className="text-sm font-medium capitalize">{label}</span>
            <Button variant="ghost" size="icon" onClick={goNext}>
              <ChevronRight />
            </Button>
          </div>
        </div>

        {loading && (
          <div className="surface flex items-center justify-center p-8">
            <Loader2 className="animate-spin" />
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum atendimento de assinante nesse período.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="surface flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">Total do período</p>
              <p className="text-xs text-muted-foreground md:text-sm">
                {prod.totalCount} atendimento{prod.totalCount === 1 ? "" : "s"} de assinantes
              </p>
            </div>
            <div className="text-right">
              <p className="brand-text font-bold">{brl(prod.totalComissao)}</p>
              <p className="text-xs text-muted-foreground md:text-sm">a repassar</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {rows.map((r) => (
            <div key={r.barberId} className="surface flex items-center justify-between p-4">
              <div>
                <p className="font-semibold">{r.name}</p>
                <p className="text-xs text-muted-foreground md:text-sm">
                  {r.count} atendimento{r.count === 1 ? "" : "s"} · referência {brl(r.total)}
                </p>
              </div>
              <div className="text-right">
                <p className="brand-text font-bold">{brl(r.comissao)}</p>
                <p className="text-xs text-muted-foreground md:text-sm">repasse</p>
              </div>
            </div>
          ))}
        </div>

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground md:text-sm">
            O repasse é o preço do serviço no momento do agendamento vezes a porcentagem que o barbeiro tem no
            plano do cliente. É uma base para o repasse manual, não uma cobrança real.
          </p>
        )}

        <Button
          variant="outline"
          onClick={exportarPdf}
          disabled={loading || exportando || rows.length === 0}
          className="w-full"
        >
          {exportando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Baixar PDF {period === "week" ? "semanal" : "mensal"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo } from "react";

import type { Barber } from "@/integrations/supabase/db-types";
import { brl } from "@/lib/format";
import type { BarberStats, Periodo } from "@/hooks/use-faturamento-totais";

const PERIODOS: { key: Exclude<Periodo, "custom">; label: string }[] = [
  { key: "hoje", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "ano", label: "Ano" },
];

/**
 * Quatro gráficos (Dia, Semana, Mês, Ano) sempre visíveis, lado a lado, só
 * no desktop (no celular a Caixa fica sem gráficos). Cada um mostra, por barbeiro, o valor acumulado no período (o
 * comprimento da barra) e o número de atendimentos (no rótulo ao lado) —
 * uma única escala, sem eixo duplo. Só atendimentos de serviço entram aqui
 * (mesma base do Ranking); venda de produto fica só nos totais gerais.
 */
export function CaixaGraficos({
  barbeiros,
  stats,
}: {
  barbeiros: Barber[];
  stats: Map<string, Record<Periodo, BarberStats>>;
}) {
  return (
    <section aria-label="Atendimentos e valor por barbeiro" className="hidden grid-cols-4 gap-3 md:grid">
      {PERIODOS.map((p) => (
        <GraficoPeriodo key={p.key} titulo={p.label} periodo={p.key} barbeiros={barbeiros} stats={stats} />
      ))}
    </section>
  );
}

function GraficoPeriodo({
  titulo,
  periodo,
  barbeiros,
  stats,
}: {
  titulo: string;
  periodo: Exclude<Periodo, "custom">;
  barbeiros: Barber[];
  stats: Map<string, Record<Periodo, BarberStats>>;
}) {
  const linhas = useMemo(
    () =>
      barbeiros
        .map((b) => ({
          id: b.id,
          nome: b.name,
          valor: stats.get(b.id)?.[periodo].valor ?? 0,
          qtd: stats.get(b.id)?.[periodo].qtd ?? 0,
        }))
        .sort((x, y) => y.valor - x.valor || y.qtd - x.qtd || x.nome.localeCompare(y.nome)),
    [barbeiros, stats, periodo],
  );
  const maximo = Math.max(...linhas.map((l) => l.valor), 0);
  const vazio = linhas.every((l) => l.qtd === 0 && l.valor === 0);

  return (
    <div className="surface p-4">
      <h3 className="mb-3 text-sm font-semibold">{titulo}</h3>
      {vazio ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Sem atendimentos neste período.</p>
      ) : (
        <ul className="space-y-3">
          {linhas.map((l) => {
            const largura = maximo > 0 ? Math.max((l.valor / maximo) * 100, l.valor > 0 ? 2 : 0) : 0;
            return (
              <li
                key={l.id}
                title={`${l.nome}: ${brl(l.valor)} em ${l.qtd} atendimento${l.qtd === 1 ? "" : "s"}`}
              >
                <div className="mb-1 text-xs">
                  <p className="truncate font-medium">{l.nome}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {l.qtd} atend. · <span className="font-semibold text-foreground">{brl(l.valor)}</span>
                  </p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/50">
                  <div
                    className="h-full rounded-full bg-[var(--brand-from)]"
                    style={{ width: `${largura}%` }}
                    role="presentation"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

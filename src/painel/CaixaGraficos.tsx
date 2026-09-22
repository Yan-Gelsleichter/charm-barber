import { useMemo } from "react";
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { Barber } from "@/integrations/supabase/db-types";
import { brl } from "@/lib/format";
import type { BarberStats, Periodo } from "@/hooks/use-faturamento-totais";

const PERIODOS: { key: Exclude<Periodo, "custom">; label: string }[] = [
  { key: "hoje", label: "Dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "ano", label: "Ano" },
];

const COR = "var(--brand-from)";
const TEXTO = "var(--foreground)";
const TEXTO_SUAVE = "var(--muted-foreground)";

function valorCurto(v: unknown) {
  return `R$ ${Math.round(Number(v) || 0).toLocaleString("pt-BR")}`;
}

/**
 * Número em cima da coluna, na diagonal — com barras próximas umas das
 * outras, um valor grande na horizontal invadia o número vizinho (ex.:
 * "R$ 2.046" por cima do "33" da coluna ao lado). Na diagonal, o texto
 * "escapa" pra cima sem esbarrar na coluna seguinte.
 */
function rotuloDiagonal(fill: string, formatar?: (v: unknown) => string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (props: any) => {
    const { x, y, width, value } = props;
    const cx = Number(x) + Number(width) / 2;
    const cy = Number(y) - 6;
    return (
      <text
        x={cx}
        y={cy}
        fill={fill}
        fontSize={12}
        fontWeight={800}
        textAnchor="start"
        transform={`rotate(-40 ${cx} ${cy})`}
      >
        {formatar ? formatar(value) : value}
      </text>
    );
  };
}

/**
 * Número de atendimentos: horizontal, centralizado em cima da própria
 * coluna (diferente do valor, que fica na diagonal — o de atendimentos é
 * sempre um número curto, então não precisa "escapar" na diagonal, e
 * fica mais fácil de ler).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rotuloQtd(props: any) {
  const { x, y, width, value } = props;
  const cx = Number(x) + Number(width) / 2;
  const cy = Number(y) - 6;
  return (
    <text x={cx} y={cy} fill={TEXTO_SUAVE} fontSize={12} fontWeight={800} textAnchor="middle">
      {value}
    </text>
  );
}

/**
 * Quatro gráficos (Dia, Semana, Mês, Ano) sempre visíveis, lado a lado, só
 * no desktop (no celular a Caixa fica sem gráficos). Cada um tem, por
 * barbeiro, duas colunas verticais: o valor acumulado (coluna escura) e o
 * número de atendimentos (coluna clara). As duas colunas têm escalas
 * próprias e nenhum eixo aparece — cada coluna traz o número escrito em
 * cima, pra ninguém ter que ler valor no eixo. Só atendimentos de serviço
 * entram aqui (mesma base do Ranking); venda de produto fica só nos
 * totais gerais.
 */
export function CaixaGraficos({
  barbeiros,
  stats,
}: {
  barbeiros: Barber[];
  stats: Map<string, Record<Periodo, BarberStats>>;
}) {
  return (
    <section aria-label="Atendimentos e valor por barbeiro" className="hidden space-y-3 md:block">
      <div className="flex items-center justify-end gap-4 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: COR }} /> Valor (R$)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: COR, opacity: 0.45 }} />{" "}
          Atendimentos
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PERIODOS.map((p) => (
          <GraficoPeriodo key={p.key} titulo={p.label} periodo={p.key} barbeiros={barbeiros} stats={stats} />
        ))}
      </div>
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
  const dados = useMemo(
    () =>
      barbeiros
        .map((b) => ({
          nome: b.name.split(" ")[0],
          nomeCompleto: b.name,
          valor: stats.get(b.id)?.[periodo].valor ?? 0,
          qtd: stats.get(b.id)?.[periodo].qtd ?? 0,
        }))
        .sort((x, y) => y.valor - x.valor || y.qtd - x.qtd || x.nome.localeCompare(y.nome)),
    [barbeiros, stats, periodo],
  );
  const vazio = dados.every((d) => d.qtd === 0 && d.valor === 0);
  const folga = (max: number) => Math.max(max, 1) * 1.2;

  return (
    <div className="surface p-3">
      <h3 className="mb-1 text-center text-base font-bold">{titulo}</h3>
      {vazio ? (
        <p className="flex h-[200px] items-center justify-center text-center text-sm text-muted-foreground">
          Sem atendimentos neste período.
        </p>
      ) : (
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} margin={{ top: 34, right: 14, left: 2, bottom: 0 }} barGap={2} barCategoryGap="18%">
              <XAxis
                dataKey="nome"
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fontSize: 12, fontWeight: 600, fill: TEXTO }}
              />
              <YAxis yAxisId="valor" hide domain={[0, folga]} />
              <YAxis yAxisId="qtd" orientation="right" hide domain={[0, folga]} />
              <Tooltip
                cursor={{ fill: "var(--secondary)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(_l, payload) => payload?.[0]?.payload?.nomeCompleto ?? ""}
                formatter={(value, name) => (name === "Valor" ? [brl(Number(value)), name] : [String(value), name])}
              />
              <Bar yAxisId="valor" dataKey="valor" name="Valor" fill={COR} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="valor" content={rotuloDiagonal(TEXTO, valorCurto)} />
              </Bar>
              <Bar
                yAxisId="qtd"
                dataKey="qtd"
                name="Atendimentos"
                fill={COR}
                fillOpacity={0.45}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                <LabelList dataKey="qtd" content={rotuloQtd} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

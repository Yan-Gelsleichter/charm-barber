import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { brl } from "@/lib/format";
import type { EvolucaoPonto } from "@/hooks/use-caixa-evolucao";

const COR = "var(--brand-from)";

/**
 * Dois gráficos de linha com a evolução do faturamento da barbearia
 * inteira (nunca quebrado por barbeiro): últimas 4 semanas e últimos 12
 * meses. Substitui os cards/gráficos por barbeiro e a lista do dia
 * enquanto a aba "Evolução" está ativa.
 */
export function CaixaEvolucao({
  semanas,
  meses,
  isLoading,
}: {
  semanas: EvolucaoPonto[];
  meses: EvolucaoPonto[];
  isLoading: boolean;
}) {
  return (
    <section aria-label="Evolução do faturamento" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <GraficoEvolucao
        titulo="Rendimento mensal"
        subtitulo="Últimas 4 semanas"
        dados={semanas}
        isLoading={isLoading}
      />
      <GraficoEvolucao
        titulo="Rendimento anual"
        subtitulo="Últimos 12 meses"
        dados={meses}
        isLoading={isLoading}
      />
    </section>
  );
}

function GraficoEvolucao({
  titulo,
  subtitulo,
  dados,
  isLoading,
}: {
  titulo: string;
  subtitulo: string;
  dados: EvolucaoPonto[];
  isLoading: boolean;
}) {
  const vazio = !isLoading && dados.every((d) => d.valor === 0);

  return (
    <div className="surface p-3 md:p-4">
      <h3 className="text-center text-base font-bold md:text-lg">{titulo}</h3>
      <p className="mb-2 text-center text-xs text-muted-foreground md:text-sm">{subtitulo}</p>

      {isLoading ? (
        <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground md:h-[280px]">
          Carregando…
        </p>
      ) : vazio ? (
        <p className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground md:h-[280px]">
          Sem faturamento neste período.
        </p>
      ) : (
        <div className="h-[220px] w-full md:h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dados} margin={{ top: 16, right: 16, left: 2, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                interval={0}
                padding={{ left: 14, right: 14 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fontSize: 12, fontWeight: 600, fill: "var(--muted-foreground)" }}
              />
              <YAxis hide domain={[0, (max: number) => Math.max(max, 1) * 1.2]} />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => [brl(Number(value)), "Faturamento"]}
              />
              <Line
                type="monotone"
                dataKey="valor"
                name="Faturamento"
                stroke={COR}
                strokeWidth={2}
                dot={{ r: 4, fill: COR, strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

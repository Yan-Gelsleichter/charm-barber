import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service, ProductOrder } from "@/integrations/supabase/db-types";
import { filterActiveAppointments, isCancellationMarker } from "@/lib/availability";
import { brazilStartOfDay, brazilStartOfWeek, brazilStartOfMonth, brazilStartOfYear } from "@/lib/timezone";

export type Periodo = "hoje" | "semana" | "mes" | "ano" | "custom";

export interface BarberStats {
  valor: number;
  qtd: number;
}

export const ZERO_STATS = (): Record<Periodo, BarberStats> => ({
  hoje: { valor: 0, qtd: 0 },
  semana: { valor: 0, qtd: 0 },
  mes: { valor: 0, qtd: 0 },
  ano: { valor: 0, qtd: 0 },
  custom: { valor: 0, qtd: 0 },
});

// Sempre pelo calendário de Brasília, não pelo fuso do aparelho de quem
// está vendo o faturamento.
function inicioDoPeriodo(p: Exclude<Periodo, "custom">): Date {
  if (p === "semana") return brazilStartOfWeek();
  if (p === "mes") return brazilStartOfMonth();
  if (p === "ano") return brazilStartOfYear();
  return brazilStartOfDay();
}

/**
 * Busca todos os agendamentos da barbearia inteira (todos os barbeiros)
 * desde o início do ano até agora e agrega faturamento (valor + nº de
 * atendimentos) por período — Hoje/Esta semana/Este mês/Este ano, e
 * opcionalmente um período personalizado. Usado por `Faturamento.tsx` e
 * pela aba `Caixa.tsx`, que precisa dos mesmos 4 cards do topo.
 */
export function useFaturamentoTotais(
  barber: Barber,
  customRange?: { ini: number; fim: number } | null,
) {
  const shopId = barber.barbershop_id ?? null;
  const customAtivo = !!customRange;

  const q = useQuery({
    queryKey: [
      "faturamento",
      shopId ?? barber.id,
      customAtivo ? `${customRange!.ini}_${customRange!.fim}` : "padrao",
    ],
    queryFn: async () => {
      let barbersQuery = supabase.from("barbers").select("*");
      barbersQuery = shopId
        ? barbersQuery.eq("barbershop_id", shopId)
        : barbersQuery.eq("id", barber.id);
      const { data: bs, error: be } = await barbersQuery;
      if (be) throw be;
      const barbeiros = (bs ?? []) as Barber[];
      const ids = barbeiros.map((b) => b.id);
      if (ids.length === 0) {
        return { barbeiros, ag: [] as Appointment[], sv: [] as Service[], po: [] as ProductOrder[] };
      }

      const inicioAnoMs = inicioDoPeriodo("ano").getTime();
      const agoraMs = Date.now();
      const desdeMs = customAtivo ? Math.min(inicioAnoMs, customRange!.ini) : inicioAnoMs;
      const ateMs = customAtivo ? Math.max(agoraMs, customRange!.fim) : agoraMs;

      const shopIdForProducts = shopId;
      const [a, s, po] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .in("barber_id", ids)
          .gte("appointment_time", new Date(desdeMs).toISOString())
          .lte("appointment_time", new Date(ateMs).toISOString())
          .order("appointment_time", { ascending: false }),
        supabase.from("services").select("*").in("barber_id", ids),
        shopIdForProducts
          ? supabase
              .from("product_orders")
              .select("*")
              .eq("barbershop_id", shopIdForProducts)
              .eq("payment_status", "pago")
              .gte("created_at", new Date(desdeMs).toISOString())
              .lte("created_at", new Date(ateMs).toISOString())
          : Promise.resolve({ data: [] as ProductOrder[], error: null }),
      ]);
      if (a.error) throw a.error;
      if (s.error) throw s.error;
      if (po.error) throw po.error;
      return {
        barbeiros,
        ag: a.data as Appointment[],
        sv: s.data as Service[],
        po: (po.data ?? []) as ProductOrder[],
      };
    },
    // Essa busca traz o ano inteiro de agendamentos — sem isso, cada vez
    // que o Caixa/Faturamento remonta (ex.: ao voltar pra aba vindo da
    // tela de Início) ela refaz a busca inteira de novo. usePaymentSync já
    // invalida essa query manualmente assim que confirma um pagamento, então
    // isso não atrasa a atualização quando o dinheiro realmente cai.
    staleTime: 30_000,
  });

  const precos = useMemo(
    () => new Map((q.data?.sv ?? []).map((s) => [s.id, Number(s.price) || 0])),
    [q.data?.sv],
  );

  // Preço travado no momento do agendamento; só cai para o preço atual do
  // serviço em agendamentos antigos que não têm esse valor salvo.
  const precoDe = (a: Appointment) => a.service_price_snapshot ?? precos.get(a.service_id) ?? 0;

  const atendidos = useMemo(
    () =>
      filterActiveAppointments(q.data?.ag ?? []).filter(
        (a) => !isCancellationMarker(a) && (a.status || "").trim().toLowerCase() !== "cancelado",
      ),
    [q.data?.ag],
  );

  const faixas = useMemo(() => {
    const agora = Date.now();
    const f: Record<Periodo, { ini: number; fim: number } | null> = {
      hoje: { ini: inicioDoPeriodo("hoje").getTime(), fim: agora },
      semana: { ini: inicioDoPeriodo("semana").getTime(), fim: agora },
      mes: { ini: inicioDoPeriodo("mes").getTime(), fim: agora },
      ano: { ini: inicioDoPeriodo("ano").getTime(), fim: agora },
      custom: customAtivo ? { ini: customRange!.ini, fim: customRange!.fim } : null,
    };
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customAtivo, customRange?.ini, customRange?.fim, q.data]);

  const totais = useMemo(() => {
    const t = ZERO_STATS();
    for (const a of atendidos) {
      const time = new Date(a.appointment_time).getTime();
      const v = precoDe(a);
      for (const key of Object.keys(faixas) as Periodo[]) {
        const fx = faixas[key];
        if (fx && time >= fx.ini && time <= fx.fim) {
          t[key].valor += v;
          t[key].qtd += 1;
        }
      }
    }
    // Receita de produto entra no valor geral (Hoje/Semana/Mês/Ano), mas não
    // no "qtd" — esse contador é só de atendimentos de serviço.
    for (const o of q.data?.po ?? []) {
      const time = new Date(o.created_at ?? "").getTime();
      for (const key of Object.keys(faixas) as Periodo[]) {
        const fx = faixas[key];
        if (fx && time >= fx.ini && time <= fx.fim) {
          t[key].valor += Number(o.total_price) || 0;
        }
      }
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atendidos, precos, faixas, q.data?.po]);

  const statsPorBarbeiro = useMemo(() => {
    const map = new Map<string, Record<Periodo, BarberStats>>();
    for (const b of q.data?.barbeiros ?? []) map.set(b.id, ZERO_STATS());
    for (const a of atendidos) {
      const row = map.get(a.barber_id);
      if (!row) continue;
      const v = precoDe(a);
      const time = new Date(a.appointment_time).getTime();
      for (const key of Object.keys(faixas) as Periodo[]) {
        const fx = faixas[key];
        if (fx && time >= fx.ini && time <= fx.fim) {
          row[key].valor += v;
          row[key].qtd += 1;
        }
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.barbeiros, atendidos, precos, faixas]);

  const servicosMap = useMemo(
    () => new Map((q.data?.sv ?? []).map((s) => [s.id, s])),
    [q.data?.sv],
  );

  return {
    isLoading: q.isLoading,
    error: q.error as Error | null,
    barbeiros: q.data?.barbeiros ?? [],
    servicosMap,
    atendidos,
    precoDe,
    faixas,
    totais,
    statsPorBarbeiro,
  };
}

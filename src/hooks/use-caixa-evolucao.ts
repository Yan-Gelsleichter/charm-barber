import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service, ProductOrder } from "@/integrations/supabase/db-types";
import { filterActiveAppointments, isCancellationMarker } from "@/lib/availability";
import { brazilStartOfMonth, brazilStartOfWeek } from "@/lib/timezone";

export interface EvolucaoPonto {
  label: string;
  valor: number;
}

/**
 * Evolução do faturamento da barbearia inteira (soma de todos os
 * barbeiros, serviços + produtos, nunca quebrado por barbeiro) — últimas 4
 * semanas e últimos 12 meses. Busca separada de `useFaturamentoTotais`
 * (que só cobre o ano corrente): aqui a janela é sempre "os últimos 12
 * meses a partir de hoje", que em janeiro/fevereiro cai no ano anterior.
 * Só busca quando `enabled` (a aba Evolução está aberta).
 */
export function useCaixaEvolucao(barber: Barber, enabled: boolean) {
  const shopId = barber.barbershop_id ?? null;

  // Início do mês, 11 meses atrás (= início da janela de 12 meses).
  const inicioJanela = useMemo(() => {
    const m = brazilStartOfMonth();
    return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 11, 1, m.getUTCHours(), 0, 0, 0));
  }, []);

  const q = useQuery({
    queryKey: ["caixa-evolucao", shopId ?? barber.id],
    enabled: enabled && !!shopId,
    queryFn: async () => {
      const { data: bs, error: be } = await supabase
        .from("barbers")
        .select("id")
        .eq("barbershop_id", shopId!);
      if (be) throw be;
      const ids = (bs ?? []).map((b) => (b as { id: string }).id);
      if (ids.length === 0) {
        return { ag: [] as Appointment[], sv: [] as Service[], po: [] as ProductOrder[] };
      }

      const desdeIso = inicioJanela.toISOString();
      const [a, s, po] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .in("barber_id", ids)
          .gte("appointment_time", desdeIso)
          .order("appointment_time", { ascending: false }),
        supabase.from("services").select("*").in("barber_id", ids),
        supabase
          .from("product_orders")
          .select("*")
          .eq("barbershop_id", shopId!)
          .eq("payment_status", "pago")
          .gte("created_at", desdeIso),
      ]);
      if (a.error) throw a.error;
      if (s.error) throw s.error;
      if (po.error) throw po.error;
      return {
        ag: a.data as Appointment[],
        sv: s.data as Service[],
        po: (po.data ?? []) as ProductOrder[],
      };
    },
    staleTime: 30_000,
  });

  const precos = useMemo(
    () => new Map((q.data?.sv ?? []).map((s) => [s.id, Number(s.price) || 0])),
    [q.data?.sv],
  );
  const precoDe = (a: Appointment) => a.service_price_snapshot ?? precos.get(a.service_id) ?? 0;

  const atendidos = useMemo(
    () =>
      filterActiveAppointments(q.data?.ag ?? []).filter(
        (a) => !isCancellationMarker(a) && (a.status || "").trim().toLowerCase() !== "cancelado",
      ),
    [q.data?.ag],
  );

  const semanas = useMemo<EvolucaoPonto[]>(() => {
    const semanaAtualIni = brazilStartOfWeek().getTime();
    const buckets = Array.from({ length: 4 }, (_, i) => {
      const ini = semanaAtualIni - (3 - i) * 7 * 86_400_000;
      const fim = ini + 7 * 86_400_000;
      return {
        ini,
        fim,
        label: new Date(ini).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "America/Sao_Paulo",
        }),
        valor: 0,
      };
    });
    for (const a of atendidos) {
      const t = new Date(a.appointment_time).getTime();
      const b = buckets.find((x) => t >= x.ini && t < x.fim);
      if (b) b.valor += precoDe(a);
    }
    for (const o of q.data?.po ?? []) {
      const t = new Date(o.created_at ?? "").getTime();
      const b = buckets.find((x) => t >= x.ini && t < x.fim);
      if (b) b.valor += Number(o.total_price) || 0;
    }
    return buckets.map((b) => ({ label: b.label, valor: b.valor }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atendidos, q.data?.po, precos]);

  const meses = useMemo<EvolucaoPonto[]>(() => {
    const mesAtual = brazilStartOfMonth();
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const iniDate = new Date(
        Date.UTC(mesAtual.getUTCFullYear(), mesAtual.getUTCMonth() - (11 - i), 1, mesAtual.getUTCHours(), 0, 0, 0),
      );
      const fimDate = new Date(
        Date.UTC(iniDate.getUTCFullYear(), iniDate.getUTCMonth() + 1, 1, mesAtual.getUTCHours(), 0, 0, 0),
      );
      const label = iniDate
        .toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" })
        .replace(".", "");
      return { ini: iniDate.getTime(), fim: fimDate.getTime(), label, valor: 0 };
    });
    for (const a of atendidos) {
      const t = new Date(a.appointment_time).getTime();
      const b = buckets.find((x) => t >= x.ini && t < x.fim);
      if (b) b.valor += precoDe(a);
    }
    for (const o of q.data?.po ?? []) {
      const t = new Date(o.created_at ?? "").getTime();
      const b = buckets.find((x) => t >= x.ini && t < x.fim);
      if (b) b.valor += Number(o.total_price) || 0;
    }
    return buckets.map((b) => ({ label: b.label, valor: b.valor }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atendidos, q.data?.po, precos]);

  return {
    isLoading: q.isLoading,
    error: q.error as Error | null,
    semanas,
    meses,
  };
}

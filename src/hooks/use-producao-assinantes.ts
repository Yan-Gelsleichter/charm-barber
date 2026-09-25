import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Service, SubscriptionPlanBarber } from "@/integrations/supabase/db-types";
import { filterActiveAppointments, isCancellationMarker } from "@/lib/availability";

export interface ProducaoLinha {
  barberId: string;
  name: string;
  count: number;
  /** Soma dos preços dos serviços (valor de referência, não é dinheiro recebido por atendimento). */
  total: number;
  /** Quanto o barbeiro recebe: preço × % definida pro barbeiro no plano que cobriu o atendimento. */
  comissao: number;
}

/**
 * Atendimentos de clientes assinantes (cobertos por assinatura) num período,
 * com a comissão de cada barbeiro calculada pela % definida no plano.
 * `barberId` restringe a um barbeiro (aba Produção do barbeiro); sem ele traz
 * a barbearia inteira (admin, aba Planos).
 */
export function useProducaoAssinantes({
  shopId,
  barberId,
  start,
  end,
  enabled = true,
}: {
  shopId: string | null;
  barberId?: string;
  start: Date;
  end: Date;
  enabled?: boolean;
}) {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const on = !!shopId && enabled;

  const appointmentsQ = useQuery({
    queryKey: ["prod-ass-appointments", shopId, barberId ?? "todos", startIso, endIso],
    enabled: on,
    queryFn: async () => {
      let query = supabase
        .from("appointments")
        .select("*")
        .eq("barbershop_id", shopId!)
        .not("covered_by_subscription_id", "is", null)
        .gte("appointment_time", startIso)
        .lte("appointment_time", endIso)
        .order("appointment_time", { ascending: true });
      if (barberId) query = query.eq("barber_id", barberId);
      const { data, error } = await query;
      if (error) throw error;
      return data as Appointment[];
    },
  });

  const servicesQ = useQuery({
    queryKey: ["prod-ass-services", shopId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as Service[];
    },
  });

  const barbersQ = useQuery({
    queryKey: ["prod-ass-barbers", shopId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from("barbers").select("id, name").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  // Cancelados (e os marcadores de cancelamento) não contam como atendimento.
  const atendimentos = useMemo(
    () =>
      filterActiveAppointments(appointmentsQ.data ?? []).filter(
        (a) => !isCancellationMarker(a) && (a.status || "").trim().toLowerCase() !== "cancelado",
      ),
    [appointmentsQ.data],
  );

  const subscriptionIds = useMemo(
    () => Array.from(new Set(atendimentos.map((a) => a.covered_by_subscription_id).filter((x): x is string => !!x))),
    [atendimentos],
  );

  // De qual plano é cada assinatura (pra saber qual % aplicar).
  const subscriptionsQ = useQuery({
    queryKey: ["prod-ass-subscriptions", shopId, subscriptionIds.join(",")],
    enabled: on && subscriptionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_subscriptions")
        .select("id, plan_id")
        .in("id", subscriptionIds);
      if (error) throw error;
      return data as { id: string; plan_id: string }[];
    },
  });

  const planIds = useMemo(
    () => Array.from(new Set((subscriptionsQ.data ?? []).map((s) => s.plan_id))),
    [subscriptionsQ.data],
  );

  const plansQ = useQuery({
    queryKey: ["prod-ass-plans", shopId, planIds.join(",")],
    enabled: on && planIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("id, name").in("id", planIds);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const planBarbersQ = useQuery({
    queryKey: ["prod-ass-plan-barbers", shopId, planIds.join(",")],
    enabled: on && planIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plan_barbers").select("*").in("plan_id", planIds);
      if (error) throw error;
      return data as SubscriptionPlanBarber[];
    },
  });

  const serviceById = useMemo(() => new Map((servicesQ.data ?? []).map((s) => [s.id, s])), [servicesQ.data]);
  const barberNameById = useMemo(() => new Map((barbersQ.data ?? []).map((b) => [b.id, b.name])), [barbersQ.data]);
  const planNameById = useMemo(() => new Map((plansQ.data ?? []).map((p) => [p.id, p.name])), [plansQ.data]);

  const planBySubscription = useMemo(
    () => new Map((subscriptionsQ.data ?? []).map((s) => [s.id, s.plan_id])),
    [subscriptionsQ.data],
  );

  const percentByPlanBarber = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of planBarbersQ.data ?? []) m.set(`${l.plan_id}:${l.barber_id}`, Number(l.commission_percent) || 0);
    return m;
  }, [planBarbersQ.data]);

  // Preço travado no momento do agendamento; só cai para o preço atual do
  // serviço em agendamentos antigos que não têm esse valor salvo.
  const priceOf = (a: Appointment) => a.service_price_snapshot ?? serviceById.get(a.service_id)?.price ?? 0;

  const planOf = (a: Appointment): string | null =>
    (a.covered_by_subscription_id && planBySubscription.get(a.covered_by_subscription_id)) || null;

  const percentOf = (a: Appointment): number => {
    const planId = planOf(a);
    return planId ? (percentByPlanBarber.get(`${planId}:${a.barber_id}`) ?? 0) : 0;
  };

  const comissaoOf = (a: Appointment) => (priceOf(a) * percentOf(a)) / 100;

  const rows = useMemo<ProducaoLinha[]>(() => {
    const map = new Map<string, { count: number; total: number; comissao: number }>();
    for (const a of atendimentos) {
      const price = a.service_price_snapshot ?? serviceById.get(a.service_id)?.price ?? 0;
      const planId = a.covered_by_subscription_id ? planBySubscription.get(a.covered_by_subscription_id) : undefined;
      const pct = planId ? (percentByPlanBarber.get(`${planId}:${a.barber_id}`) ?? 0) : 0;
      const cur = map.get(a.barber_id) ?? { count: 0, total: 0, comissao: 0 };
      cur.count += 1;
      cur.total += price;
      cur.comissao += (price * pct) / 100;
      map.set(a.barber_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ barberId: id, name: barberNameById.get(id) ?? "Barbeiro", ...v }))
      .sort((x, y) => y.total - x.total);
  }, [atendimentos, serviceById, planBySubscription, percentByPlanBarber, barberNameById]);

  const loading =
    (on && (appointmentsQ.isLoading || servicesQ.isLoading || barbersQ.isLoading)) ||
    subscriptionsQ.isLoading ||
    plansQ.isLoading ||
    planBarbersQ.isLoading;

  return {
    loading,
    atendimentos,
    rows,
    totalCount: rows.reduce((s, r) => s + r.count, 0),
    totalValor: rows.reduce((s, r) => s + r.total, 0),
    totalComissao: rows.reduce((s, r) => s + r.comissao, 0),
    serviceById,
    barberNameById,
    planNameById,
    priceOf,
    planOf,
    percentOf,
    comissaoOf,
  };
}

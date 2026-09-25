import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { supabase } from "@/integrations/supabase/client";
import type {
  Barber,
  Service,
  SubscriptionPlanBarber,
  SubscriptionPlanService,
} from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { useProducaoAssinantes } from "@/hooks/use-producao-assinantes";
import { brl } from "@/lib/format";

/** Aba "Produção" do barbeiro comum: planos de que participa, sua porcentagem e seus atendimentos de assinantes. */
export function ProducaoBarbeiroTab({ barber }: { barber: Barber }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Produção</h1>
        <p className="text-sm text-muted-foreground">
          Os planos de assinatura de que você participa e quantos atendimentos de assinantes você fez.
        </p>
      </header>

      <MeusPlanos barber={barber} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PeriodoCard barber={barber} tipo="week" />
        <PeriodoCard barber={barber} tipo="month" />
      </div>
    </div>
  );
}

function MeusPlanos({ barber }: { barber: Barber }) {
  const shopId = barber.barbershop_id ?? null;

  const linksQ = useQuery({
    queryKey: ["prod-barbeiro-plan-links", barber.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plan_barbers")
        .select("*")
        .eq("barber_id", barber.id);
      if (error) throw error;
      return data as SubscriptionPlanBarber[];
    },
  });

  const planIds = useMemo(() => (linksQ.data ?? []).map((l) => l.plan_id), [linksQ.data]);

  const plansQ = useQuery({
    queryKey: ["prod-barbeiro-plans", planIds.join(",")],
    enabled: planIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("id, name").in("id", planIds);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const planServicesQ = useQuery({
    queryKey: ["prod-barbeiro-plan-services", planIds.join(",")],
    enabled: planIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plan_services").select("*").in("plan_id", planIds);
      if (error) throw error;
      return data as SubscriptionPlanService[];
    },
  });

  const servicesQ = useQuery({
    queryKey: ["prod-barbeiro-services", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as Service[];
    },
  });

  const serviceById = useMemo(() => new Map((servicesQ.data ?? []).map((s) => [s.id, s])), [servicesQ.data]);

  const cards = useMemo(() => {
    const planName = new Map((plansQ.data ?? []).map((p) => [p.id, p.name]));
    return (linksQ.data ?? [])
      .filter((l) => planName.has(l.plan_id))
      .map((l) => {
        const all = (planServicesQ.data ?? [])
          .filter((ps) => ps.plan_id === l.plan_id)
          .map((ps) => serviceById.get(ps.service_id))
          .filter((s): s is Service => !!s);
        // "Serviços que ele cobre" = os do próprio barbeiro dentro do plano.
        const mine = all.filter((s) => s.barber_id === barber.id);
        return {
          planId: l.plan_id,
          name: planName.get(l.plan_id) ?? "Plano",
          percent: Number(l.commission_percent) || 0,
          services: (mine.length > 0 ? mine : all).map((s) => s.name),
        };
      });
  }, [linksQ.data, plansQ.data, planServicesQ.data, serviceById, barber.id]);

  const loading = linksQ.isLoading || plansQ.isLoading || planServicesQ.isLoading || servicesQ.isLoading;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Meus planos</h2>

      {loading ? (
        <div className="surface flex items-center justify-center p-6">
          <Loader2 className="animate-spin" />
        </div>
      ) : cards.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Você ainda não participa de nenhum plano de assinatura.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {cards.map((c) => (
            <div key={c.planId} className="surface p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="break-words font-semibold">{c.name}</p>
                <span className="brand-text shrink-0 font-bold">{c.percent}%</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground md:text-sm">
                Serviços que você cobre: {c.services.join(", ") || "—"}
              </p>
              <p className="text-xs text-muted-foreground md:text-sm">
                Você recebe {c.percent}% do valor de cada atendimento desse plano.
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PeriodoCard({ barber, tipo }: { barber: Barber; tipo: "week" | "month" }) {
  const [anchor, setAnchor] = useState(() => new Date());

  const { start, end, label } = useMemo(() => {
    if (tipo === "week") {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      const e = endOfWeek(anchor, { weekStartsOn: 1 });
      return { start: s, end: e, label: `${format(s, "dd/MM")} – ${format(e, "dd/MM")}` };
    }
    const s = startOfMonth(anchor);
    const e = endOfMonth(anchor);
    return { start: s, end: e, label: format(s, "MMMM 'de' yyyy", { locale: ptBR }) };
  }, [tipo, anchor]);

  const prod = useProducaoAssinantes({
    shopId: barber.barbershop_id ?? null,
    barberId: barber.id,
    start,
    end,
  });

  const step = (dir: 1 | -1) => setAnchor((d) => (tipo === "week" ? addWeeks(d, dir) : addMonths(d, dir)));

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{tipo === "week" ? "Semana" : "Mês"}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Período anterior">
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-sm font-medium capitalize">{label}</span>
          <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Próximo período">
            <ChevronRight />
          </Button>
        </div>
      </div>

      {prod.loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="brand-text text-3xl font-extrabold">{prod.totalCount}</p>
            <p className="text-xs text-muted-foreground md:text-sm">
              atendimento{prod.totalCount === 1 ? "" : "s"} de assinantes
            </p>
          </div>
          <div>
            <p className="brand-text text-3xl font-extrabold">{brl(prod.totalComissao)}</p>
            <p className="text-xs text-muted-foreground md:text-sm">comissão (referência)</p>
          </div>
        </div>
      )}
    </section>
  );
}

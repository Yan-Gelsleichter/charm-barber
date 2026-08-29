import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import type {
  SubscriptionPlan,
  SubscriptionPlanService,
  SubscriptionPlanBarber,
  Service,
} from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { postPublicApi } from "@/lib/api-fetch";

export const Route = createFileRoute("/assinar/$barbershopId")({
  head: () => ({ meta: [{ title: "Planos de assinatura — VIP BARBER" }] }),
  component: AssinarPage,
});

function AssinarPage() {
  const { barbershopId } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [subscribingId, setSubscribingId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const plansQ = useQuery({
    queryKey: ["public-subscription-plans", barbershopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("barbershop_id", barbershopId)
        .eq("active", true)
        .order("price");
      if (error) throw error;
      return data as SubscriptionPlan[];
    },
  });

  const planServicesQ = useQuery({
    queryKey: ["public-subscription-plan-services", barbershopId, plansQ.data?.map((p) => p.id).join(",")],
    enabled: !!plansQ.data && plansQ.data.length > 0,
    queryFn: async () => {
      const planIds = (plansQ.data ?? []).map((p) => p.id);
      const { data, error } = await supabase.from("subscription_plan_services").select("*").in("plan_id", planIds);
      if (error) throw error;
      return data as SubscriptionPlanService[];
    },
  });

  const servicesQ = useQuery({
    queryKey: ["public-services-for-plans", barbershopId],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("barbershop_id", barbershopId);
      if (error) throw error;
      return data as Service[];
    },
  });

  const planBarbersQ = useQuery({
    queryKey: ["public-subscription-plan-barbers", barbershopId, plansQ.data?.map((p) => p.id).join(",")],
    enabled: !!plansQ.data && plansQ.data.length > 0,
    queryFn: async () => {
      const planIds = (plansQ.data ?? []).map((p) => p.id);
      const { data, error } = await supabase.from("subscription_plan_barbers").select("*").in("plan_id", planIds);
      if (error) throw error;
      return data as SubscriptionPlanBarber[];
    },
  });

  const barbersQ = useQuery({
    queryKey: ["public-barbers-for-plans", barbershopId],
    queryFn: async () => {
      const { data, error } = await supabase.from("barbers").select("id, name").eq("barbershop_id", barbershopId);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const barberNameById = useMemo(() => {
    const m = new Map<string, string>();
    (barbersQ.data ?? []).forEach((b) => m.set(b.id, b.name));
    return m;
  }, [barbersQ.data]);

  const barbersByPlan = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const link of planBarbersQ.data ?? []) {
      const name = barberNameById.get(link.barber_id);
      if (!name) continue;
      if (!groups.has(link.plan_id)) groups.set(link.plan_id, []);
      groups.get(link.plan_id)!.push(name);
    }
    return groups;
  }, [planBarbersQ.data, barberNameById]);

  const serviceById = useMemo(() => {
    const m = new Map<string, Service>();
    (servicesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [servicesQ.data]);

  const servicesByPlan = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const link of planServicesQ.data ?? []) {
      const svc = serviceById.get(link.service_id);
      if (!svc) continue;
      if (!groups.has(link.plan_id)) groups.set(link.plan_id, []);
      groups.get(link.plan_id)!.push(svc);
    }
    return groups;
  }, [planServicesQ.data, serviceById]);

  const subscribe = useMutation({
    mutationFn: async (planId: string) => {
      const result = await postPublicApi<{ subscription_id?: string; init_point?: string; error?: string }>(
        "/api/public/mercadopago-preapproval",
        { plan_id: planId },
        session?.access_token,
      );
      if (!result?.init_point) throw new Error(result?.error ?? "Não foi possível iniciar a assinatura.");
      return result.init_point;
    },
    onMutate: (planId) => setSubscribingId(planId),
    onSuccess: (initPoint) => {
      window.location.href = initPoint;
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setSubscribingId(null);
    },
  });

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/">
          <ArrowLeft /> Voltar
        </Link>
      </Button>

      <header className="mb-6">
        <h1 className="text-xl font-semibold">Planos de assinatura</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assine um plano mensal e tenha os serviços inclusos sem pagar por visita.
        </p>
      </header>

      {plansQ.isLoading && (
        <div className="grid grid-cols-1 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="surface h-32 animate-pulse" />
          ))}
        </div>
      )}

      {!plansQ.isLoading && (plansQ.data ?? []).length === 0 && (
        <div className="surface p-8 text-center text-sm text-muted-foreground">
          Nenhum plano disponível nesta barbearia no momento.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {plansQ.data?.map((plan) => (
          <div key={plan.id} className="surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="brand-text text-lg font-bold">{brl(plan.price)}/mês</p>
            </div>
            {plan.description && <p className="mt-1 break-words text-sm text-muted-foreground">{plan.description}</p>}
            <ul className="mt-3 space-y-1">
              {(servicesByPlan.get(plan.id) ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="size-4 text-success" /> {s.name} ilimitado
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Disponível com: {(barbersByPlan.get(plan.id) ?? []).join(", ") || "a definir"}
            </p>
            <Button
              variant="hero"
              className="mt-4 w-full"
              disabled={subscribe.isPending && subscribingId === plan.id}
              onClick={() => subscribe.mutate(plan.id)}
            >
              {subscribe.isPending && subscribingId === plan.id ? (
                <Loader2 className="animate-spin" />
              ) : (
                "Assinar"
              )}
            </Button>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        A cobrança é mensal e automática no cartão de crédito, via Mercado Pago. Você pode cancelar quando quiser.
      </p>
    </main>
  );
}

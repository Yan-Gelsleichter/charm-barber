import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, X, Save, Power, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type {
  Barber,
  Service,
  SubscriptionPlan,
  SubscriptionPlanService,
  ClientSubscription,
  Client,
} from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";
import { postPublicApi } from "@/lib/api-fetch";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  authorized: "Autorizada",
  active: "Ativa",
  paused: "Pausada",
  cancelled: "Cancelada",
  payment_failed: "Pagamento falhou",
};

export function PlanosTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const shopId = barber.barbershop_id ?? null;

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);

  // Todos os serviços da barbearia (de todos os barbeiros), para montar a
  // seleção de "o que entra no plano" — cada barbeiro tem seu próprio
  // cadastro de serviços, então listamos todos agrupados por barbeiro.
  const barbersQ = useQuery({
    queryKey: ["shop-barbers", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from("barbers").select("id, name").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const servicesQ = useQuery({
    queryKey: ["shop-services", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("barbershop_id", shopId!).order("name");
      if (error) throw error;
      return data as Service[];
    },
  });

  const barberNameById = useMemo(() => {
    const m = new Map<string, string>();
    (barbersQ.data ?? []).forEach((b) => m.set(b.id, b.name));
    return m;
  }, [barbersQ.data]);

  const servicesByBarber = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const s of servicesQ.data ?? []) {
      const key = s.barber_id ?? "sem-barbeiro";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return groups;
  }, [servicesQ.data]);

  const plansQ = useQuery({
    queryKey: ["subscription-plans", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("barbershop_id", shopId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SubscriptionPlan[];
    },
  });

  const planServicesQ = useQuery({
    queryKey: ["subscription-plan-services", shopId, plansQ.data?.map((p) => p.id).join(",")],
    enabled: !!plansQ.data && plansQ.data.length > 0,
    queryFn: async () => {
      const planIds = (plansQ.data ?? []).map((p) => p.id);
      const { data, error } = await supabase
        .from("subscription_plan_services")
        .select("*")
        .in("plan_id", planIds);
      if (error) throw error;
      return data as SubscriptionPlanService[];
    },
  });

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

  const subscribersQ = useQuery({
    queryKey: ["client-subscriptions", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_subscriptions")
        .select("*")
        .eq("barbershop_id", shopId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ClientSubscription[];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["shop-clients-for-subscriptions", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as Client[];
    },
  });

  const clientById = useMemo(() => {
    const m = new Map<string, Client>();
    (clientsQ.data ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [clientsQ.data]);

  const planById = useMemo(() => {
    const m = new Map<string, SubscriptionPlan>();
    (plansQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [plansQ.data]);

  function reset() {
    setName("");
    setPrice("");
    setSelectedServiceIds(new Set());
    setEditing(null);
  }

  function startEdit(p: SubscriptionPlan) {
    setEditing(p);
    setName(p.name);
    setPrice(String(p.price).replace(".", ","));
    const included = servicesByPlan.get(p.id) ?? [];
    setSelectedServiceIds(new Set(included.map((s) => s.id)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Nome do plano muito curto");
      const pre = Number(price.replace(",", "."));
      if (!pre || pre <= 0) throw new Error("Valor mensal inválido");
      if (selectedServiceIds.size === 0) throw new Error("Selecione ao menos um serviço incluso");

      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = shopId ?? (await getBarbershopIdByBarberId(barber.id));
      if (!barbershopId) throw new Error("Não foi possível identificar a barbearia");

      let planId: string;
      if (editing) {
        planId = editing.id;
        const { error } = await supabase
          .from("subscription_plans")
          .update({ name: name.trim(), price: pre })
          .eq("id", planId);
        if (error) throw error;
        const { error: delErr } = await supabase
          .from("subscription_plan_services")
          .delete()
          .eq("plan_id", planId);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase
          .from("subscription_plans")
          .insert({ name: name.trim(), price: pre, barbershop_id: barbershopId })
          .select()
          .single();
        if (error) throw error;
        planId = (data as SubscriptionPlan).id;
      }

      const rows = Array.from(selectedServiceIds).map((service_id) => ({ plan_id: planId, service_id }));
      const { error: insErr } = await supabase.from("subscription_plan_services").insert(rows);
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      toast.success(editing ? "Plano atualizado" : "Plano criado");
      reset();
      qc.invalidateQueries({ queryKey: ["subscription-plans", shopId] });
      qc.invalidateQueries({ queryKey: ["subscription-plan-services", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: SubscriptionPlan) => {
      const { error } = await supabase.from("subscription_plans").update({ active: !p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscription-plans", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelSubscription = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const session = (await supabase.auth.getSession()).data.session;
      await postPublicApi("/api/public/mercadopago-subscription-cancel", { subscription_id: subscriptionId }, session?.access_token);
    },
    onSuccess: () => {
      toast.success("Assinatura cancelada");
      qc.invalidateQueries({ queryKey: ["client-subscriptions", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Planos de assinatura</h1>
        <p className="text-sm text-muted-foreground">
          Crie planos mensais (ex.: "Corte ilimitado") e escolha quais serviços entram ilimitados em cada um.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{editing ? "Editar plano" : "Novo plano"}</h2>
          {editing && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X /> Cancelar
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div className="space-y-1">
            <Label>Nome do plano</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Corte ilimitado" />
          </div>
          <div className="space-y-1">
            <Label>Valor mensal (R$)</Label>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="99,90"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Serviços inclusos (ilimitados no mês)</Label>
          {servicesQ.isLoading && <Loader2 className="animate-spin" />}
          {!servicesQ.isLoading && (servicesQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum serviço cadastrado ainda. Cadastre serviços na aba "Serviços" primeiro.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from(servicesByBarber.entries()).map(([barberId, list]) => (
              <div key={barberId} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {barberNameById.get(barberId) ?? "Sem barbeiro"}
                </p>
                <div className="space-y-1">
                  {list.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedServiceIds.has(s.id)}
                          onChange={() => toggleService(s.id)}
                        />
                        {s.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{brl(s.price)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button variant="hero" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
          {editing ? "Salvar alterações" : "Criar plano"}
        </Button>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">Planos cadastrados</h2>
        {plansQ.data?.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">Nenhum plano cadastrado ainda.</div>
        )}
        <div className="grid gap-2">
          {plansQ.data?.map((p) => (
            <div key={p.id} className="surface flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{p.name}</p>
                  {!p.active && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Inativo
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {(servicesByPlan.get(p.id) ?? []).map((s) => s.name).join(", ") || "sem serviços"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="brand-text font-bold">{brl(p.price)}/mês</span>
                <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={p.active ? "Desativar plano" : "Reativar plano"}
                  onClick={() => toggleActive.mutate(p)}
                >
                  <Power className={p.active ? "text-destructive" : "text-success"} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <Users className="size-4" /> Assinantes
        </h2>
        {subscribersQ.data?.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Ninguém assinou um plano ainda.
          </div>
        )}
        <div className="grid gap-2">
          {subscribersQ.data?.map((s) => {
            const client = clientById.get(s.client_id);
            const plan = planById.get(s.plan_id);
            return (
              <div key={s.id} className="surface flex items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{client?.name ?? "Cliente"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {plan?.name ?? "Plano"} • {STATUS_LABEL[s.status] ?? s.status}
                    {s.current_period_end && ` • próxima cobrança ${new Date(s.current_period_end).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                {(s.status === "active" || s.status === "authorized") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirm(`Cancelar a assinatura de "${client?.name ?? "cliente"}"?`) && cancelSubscription.mutate(s.id)}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

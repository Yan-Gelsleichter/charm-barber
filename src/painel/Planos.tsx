import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, X, Save, Power, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type {
  Barber,
  Service,
  SubscriptionPlan,
  SubscriptionPlanService,
  SubscriptionPlanBarber,
  ClientSubscription,
  Client,
} from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [selectedBarberIds, setSelectedBarberIds] = useState<Set<string>>(new Set());
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

  const planBarbersQ = useQuery({
    queryKey: ["subscription-plan-barbers", shopId, plansQ.data?.map((p) => p.id).join(",")],
    enabled: !!plansQ.data && plansQ.data.length > 0,
    queryFn: async () => {
      const planIds = (plansQ.data ?? []).map((p) => p.id);
      const { data, error } = await supabase
        .from("subscription_plan_barbers")
        .select("*")
        .in("plan_id", planIds);
      if (error) throw error;
      return data as SubscriptionPlanBarber[];
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

  const barbersByPlan = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const link of planBarbersQ.data ?? []) {
      const barberName = barberNameById.get(link.barber_id);
      if (!barberName) continue;
      if (!groups.has(link.plan_id)) groups.set(link.plan_id, []);
      groups.get(link.plan_id)!.push(barberName);
    }
    return groups;
  }, [planBarbersQ.data, barberNameById]);

  const barberIdsByPlan = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    for (const link of planBarbersQ.data ?? []) {
      if (!groups.has(link.plan_id)) groups.set(link.plan_id, new Set());
      groups.get(link.plan_id)!.add(link.barber_id);
    }
    return groups;
  }, [planBarbersQ.data]);

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
    setDescription("");
    setPrice("");
    setSelectedServiceIds(new Set());
    setSelectedBarberIds(new Set());
    setEditing(null);
  }

  function startEdit(p: SubscriptionPlan) {
    setEditing(p);
    setName(p.name);
    setDescription(p.description ?? "");
    setPrice(String(p.price).replace(".", ","));
    const included = servicesByPlan.get(p.id) ?? [];
    setSelectedServiceIds(new Set(included.map((s) => s.id)));
    setSelectedBarberIds(new Set(barberIdsByPlan.get(p.id) ?? []));
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

  function toggleBarber(id: string) {
    setSelectedBarberIds((prev) => {
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
      if (selectedBarberIds.size === 0) throw new Error("Selecione ao menos um barbeiro para o plano");

      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = shopId ?? (await getBarbershopIdByBarberId(barber.id));
      if (!barbershopId) throw new Error("Não foi possível identificar a barbearia");

      let planId: string;
      if (editing) {
        planId = editing.id;
        const { error } = await supabase
          .from("subscription_plans")
          .update({ name: name.trim(), description: description.trim() || null, price: pre })
          .eq("id", planId);
        if (error) throw error;
        const { error: delErr } = await supabase
          .from("subscription_plan_services")
          .delete()
          .eq("plan_id", planId);
        if (delErr) throw delErr;
        const { error: delBarberErr } = await supabase
          .from("subscription_plan_barbers")
          .delete()
          .eq("plan_id", planId);
        if (delBarberErr) throw delBarberErr;
      } else {
        const { data, error } = await supabase
          .from("subscription_plans")
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            price: pre,
            barbershop_id: barbershopId,
          })
          .select()
          .single();
        if (error) throw error;
        planId = (data as SubscriptionPlan).id;
      }

      const serviceRows = Array.from(selectedServiceIds).map((service_id) => ({ plan_id: planId, service_id }));
      const { error: insErr } = await supabase.from("subscription_plan_services").insert(serviceRows);
      if (insErr) throw insErr;

      const barberRows = Array.from(selectedBarberIds).map((barber_id) => ({ plan_id: planId, barber_id }));
      const { error: insBarberErr } = await supabase.from("subscription_plan_barbers").insert(barberRows);
      if (insBarberErr) throw insBarberErr;
    },
    onSuccess: () => {
      toast.success(editing ? "Plano atualizado" : "Plano criado");
      reset();
      qc.invalidateQueries({ queryKey: ["subscription-plans", shopId] });
      qc.invalidateQueries({ queryKey: ["subscription-plan-services", shopId] });
      qc.invalidateQueries({ queryKey: ["subscription-plan-barbers", shopId] });
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

  const deletePlan = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.from("subscription_plans").delete().eq("id", planId);
      if (error) {
        if (error.code === "23503") {
          throw new Error(
            "Não é possível excluir: esse plano já teve assinantes. Desative-o em vez de excluir, pra manter o histórico.",
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Plano excluído");
      qc.invalidateQueries({ queryKey: ["subscription-plans", shopId] });
      qc.invalidateQueries({ queryKey: ["subscription-plan-services", shopId] });
      qc.invalidateQueries({ queryKey: ["subscription-plan-barbers", shopId] });
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
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

        <div className="space-y-1">
          <Label>Descrição do plano (opcional)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: corte ilimitado todo mês, agende quantas vezes quiser."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label>Barbeiros que atendem esse plano</Label>
          {barbersQ.isLoading && <Loader2 className="animate-spin" />}
          {!barbersQ.isLoading && (barbersQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum barbeiro cadastrado ainda.</p>
          )}
          {(barbersQ.data ?? []).length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {barbersQ.data?.map((b) => (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedBarberIds.has(b.id)}
                      onChange={() => toggleBarber(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Só agendamentos com um desses barbeiros contam como inclusos na assinatura.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Serviços inclusos (ilimitados no mês)</Label>
          {servicesQ.isLoading && <Loader2 className="animate-spin" />}
          {!servicesQ.isLoading && (servicesQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum serviço cadastrado ainda. Cadastre serviços na aba "Serviços" primeiro.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <div className="grid grid-cols-1 gap-2">
          {plansQ.data?.map((p) => (
            <div key={p.id} className="surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words font-semibold">{p.name}</p>
                {!p.active && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Inativo
                  </span>
                )}
              </div>
              {p.description && <p className="mt-1 break-words text-xs text-muted-foreground">{p.description}</p>}
              <p className="mt-1 break-words text-xs text-muted-foreground">
                Serviços: {(servicesByPlan.get(p.id) ?? []).map((s) => s.name).join(", ") || "sem serviços"}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                Com: {(barbersByPlan.get(p.id) ?? []).join(", ") || "nenhum barbeiro"}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <span className="brand-text text-base font-bold">{brl(p.price)}/mês</span>
                <div className="flex shrink-0 items-center gap-1">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Excluir plano"
                    onClick={() => {
                      if (
                        confirm(
                          `Excluir o plano "${p.name}" permanentemente? Essa ação não pode ser desfeita.`,
                        )
                      ) {
                        deletePlan.mutate(p.id);
                      }
                    }}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
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
        <div className="grid grid-cols-1 gap-2">
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

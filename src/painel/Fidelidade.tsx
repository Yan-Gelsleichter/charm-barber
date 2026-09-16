import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, X, Save, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, Service, LoyaltyProgram, LoyaltyProgramService } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function FidelidadeTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const shopId = barber.barbershop_id ?? null;

  const [name, setName] = useState("");
  const [scope, setScope] = useState<"generic" | "services">("generic");
  const [goal, setGoal] = useState("10");
  const [includeWalkIn, setIncludeWalkIn] = useState(true);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<LoyaltyProgram | null>(null);

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

  const programsQ = useQuery({
    queryKey: ["loyalty-programs", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loyalty_programs")
        .select("*")
        .eq("barbershop_id", shopId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LoyaltyProgram[];
    },
  });

  const programServicesQ = useQuery({
    queryKey: ["loyalty-program-services", shopId, programsQ.data?.map((p) => p.id).join(",")],
    enabled: !!programsQ.data && programsQ.data.length > 0,
    queryFn: async () => {
      const programIds = (programsQ.data ?? []).map((p) => p.id);
      const { data, error } = await supabase
        .from("loyalty_program_services")
        .select("*")
        .in("program_id", programIds);
      if (error) throw error;
      return data as LoyaltyProgramService[];
    },
  });

  const serviceById = useMemo(() => {
    const m = new Map<string, Service>();
    (servicesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [servicesQ.data]);

  const servicesByProgram = useMemo(() => {
    const groups = new Map<string, Service[]>();
    for (const link of programServicesQ.data ?? []) {
      const svc = serviceById.get(link.service_id);
      if (!svc) continue;
      if (!groups.has(link.program_id)) groups.set(link.program_id, []);
      groups.get(link.program_id)!.push(svc);
    }
    return groups;
  }, [programServicesQ.data, serviceById]);

  function reset() {
    setName("");
    setScope("generic");
    setGoal("10");
    setIncludeWalkIn(true);
    setSelectedServiceIds(new Set());
    setEditing(null);
  }

  function startEdit(p: LoyaltyProgram) {
    setEditing(p);
    setName(p.name);
    setScope(p.scope);
    setGoal(String(p.goal));
    setIncludeWalkIn(p.include_walk_in);
    const included = servicesByProgram.get(p.id) ?? [];
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
      if (name.trim().length < 2) throw new Error("Nome do programa muito curto");
      const goalNum = Number(goal);
      if (!goalNum || goalNum <= 0) throw new Error("Meta inválida");
      if (scope === "services" && selectedServiceIds.size === 0) {
        throw new Error("Selecione ao menos um serviço, ou use o modo genérico");
      }

      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = shopId ?? (await getBarbershopIdByBarberId(barber.id));
      if (!barbershopId) throw new Error("Não foi possível identificar a barbearia");

      let programId: string;
      if (editing) {
        programId = editing.id;
        const { error } = await supabase
          .from("loyalty_programs")
          .update({ name: name.trim(), scope, goal: goalNum, include_walk_in: includeWalkIn })
          .eq("id", programId);
        if (error) throw error;
        const { error: delErr } = await supabase
          .from("loyalty_program_services")
          .delete()
          .eq("program_id", programId);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase
          .from("loyalty_programs")
          .insert({
            name: name.trim(),
            scope,
            goal: goalNum,
            include_walk_in: includeWalkIn,
            barbershop_id: barbershopId,
          })
          .select()
          .single();
        if (error) throw error;
        programId = (data as LoyaltyProgram).id;
      }

      if (scope === "services" && selectedServiceIds.size > 0) {
        const rows = Array.from(selectedServiceIds).map((service_id) => ({ program_id: programId, service_id }));
        const { error: insErr } = await supabase.from("loyalty_program_services").insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Programa atualizado" : "Programa criado");
      reset();
      qc.invalidateQueries({ queryKey: ["loyalty-programs", shopId] });
      qc.invalidateQueries({ queryKey: ["loyalty-program-services", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: LoyaltyProgram) => {
      const { error } = await supabase.from("loyalty_programs").update({ active: !p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-programs", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteProgram = useMutation({
    mutationFn: async (programId: string) => {
      const { error } = await supabase.from("loyalty_programs").delete().eq("id", programId);
      if (error) {
        if (error.code === "23503") {
          throw new Error(
            "Não é possível excluir: esse programa já tem resgates usados. Desative-o em vez de excluir, pra manter o histórico.",
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Programa excluído");
      qc.invalidateQueries({ queryKey: ["loyalty-programs", shopId] });
      qc.invalidateQueries({ queryKey: ["loyalty-program-services", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Fidelidade</h1>
        <p className="text-sm text-muted-foreground">
          Crie programas de fidelidade (ex.: "a cada 10 cortes, o 11º é grátis") por serviço ou genéricos.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{editing ? "Editar programa" : "Novo programa"}</h2>
          {editing && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X /> Cancelar
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-1">
            <Label>Nome do programa</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Fidelidade Corte" />
          </div>
          <div className="space-y-1">
            <Label>Meta (nº de atendimentos)</Label>
            <Input
              inputMode="numeric"
              value={goal}
              onChange={(e) => setGoal(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="10"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Vale para</Label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "generic", label: "Qualquer atendimento" },
                { id: "services", label: "Serviços específicos" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScope(opt.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-center text-sm font-medium transition",
                  scope === opt.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:border-primary/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {scope === "services" && (
          <div className="space-y-2">
            <Label>Serviços que contam ponto</Label>
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
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedServiceIds.has(s.id)}
                          onChange={() => toggleService(s.id)}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
          <div>
            <p className="text-sm font-medium">Incluir atendimentos avulsos</p>
            <p className="text-xs text-muted-foreground">
              Conta ponto também pros atendimentos lançados no Caixa (sem passar pelo app).
            </p>
          </div>
          <Switch checked={includeWalkIn} onCheckedChange={setIncludeWalkIn} />
        </div>

        <Button variant="hero" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
          {editing ? "Salvar alterações" : "Criar programa"}
        </Button>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Programas cadastrados
        </h2>
        {programsQ.data?.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum programa de fidelidade cadastrado ainda.
          </div>
        )}
        <div className="grid grid-cols-1 gap-2">
          {programsQ.data?.map((p) => (
            <div key={p.id} className="surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words font-semibold">{p.name}</p>
                {!p.active && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Inativo
                  </span>
                )}
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {p.scope === "generic"
                  ? "Qualquer atendimento"
                  : (servicesByProgram.get(p.id) ?? []).map((s) => s.name).join(", ") || "sem serviços"}
                {" · "}a cada {p.goal}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.include_walk_in ? "Inclui atendimentos avulsos" : "Só atendimentos feitos pelo app"}
              </p>

              <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-3">
                <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={p.active ? "Desativar programa" : "Reativar programa"}
                  onClick={() => toggleActive.mutate(p)}
                >
                  <Power className={p.active ? "text-destructive" : "text-success"} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Excluir programa"
                  onClick={() => {
                    if (confirm(`Excluir o programa "${p.name}" permanentemente? Essa ação não pode ser desfeita.`)) {
                      deleteProgram.mutate(p.id);
                    }
                  }}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

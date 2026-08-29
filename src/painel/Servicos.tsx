import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, Service } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";

export function ServicosTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [duracao, setDuracao] = useState("30");
  const [preco, setPreco] = useState("");

  const q = useQuery({
    queryKey: ["services-painel", barber.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("barber_id", barber.id)
        .order("name");
      if (error) throw error;
      return data as Service[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (nome.trim().length < 2) throw new Error("Nome muito curto");
      const dur = Number(duracao);
      const pre = Number(preco.replace(",", "."));
      if (!dur || dur < 5) throw new Error("Duração inválida");
      if (!pre || pre <= 0) throw new Error("Preço inválido");
      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = barber.barbershop_id ?? (await getBarbershopIdByBarberId(barber.id));
      const { error } = await supabase.from("services").insert({
        name: nome.trim(),
        duration_minutes: dur,
        price: pre,
        barber_id: barber.id,
        barbershop_id: barbershopId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Serviço criado");
      setNome("");
      setPreco("");
      qc.invalidateQueries({ queryKey: ["services-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Serviço removido");
      qc.invalidateQueries({ queryKey: ["services-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <section className="surface p-4">
        <h2 className="mb-3 font-semibold">Novo serviço</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_140px_auto]">
          <div className="space-y-1">
            <Label htmlFor="snome">Nome</Label>
            <Input id="snome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Corte simples" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sdur">Duração (min)</Label>
            <Input
              id="sdur"
              inputMode="numeric"
              value={duracao}
              onChange={(e) => setDuracao(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="spre">Preço (R$)</Label>
            <Input
              id="spre"
              inputMode="decimal"
              value={preco}
              onChange={(e) => setPreco(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="35,00"
            />
          </div>
          <div className="flex items-end">
            <Button variant="hero" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
            </Button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Meus serviços
        </h2>
        {q.data?.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum serviço cadastrado.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {q.data?.map((s) => (
              <div key={s.id} className="surface flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.duration_minutes} min</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="brand-text font-bold">{brl(s.price)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => confirm("Remover serviço?") && remove.mutate(s.id)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Pencil, Trash2, X, Save, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, Client } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailInput } from "@/components/EmailInput";
import { PhoneInput } from "@/components/PhoneInput";

export function ClientesTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  const [search, setSearch] = useState("");

  const isAdmin = !!barber.is_admin;
  const scopeKey = isAdmin ? `shop:${barber.barbershop_id ?? "none"}` : `barber:${barber.id}`;

  const q = useQuery({
    queryKey: ["clients", scopeKey],
    queryFn: async () => {
      let query = supabase.from("clients").select("*").order("name");
      if (isAdmin && barber.barbershop_id) {
        // Admin vê todos os clientes da barbearia
        query = query.eq("barbershop_id", barber.barbershop_id);
      } else {
        // Barbeiro comum vê apenas seus próprios clientes
        query = query.eq("barber_id", barber.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Client[];
    },
  });

  const reset = () => {
    setName("");
    setEmail("");
    setWhatsapp("");
    setEditing(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Nome muito curto");
      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = barber.barbershop_id ?? (await getBarbershopIdByBarberId(barber.id));
      const payload = {
        name: name.trim(),
        email: email.trim() || null,
        whatsapp: whatsapp.trim() || null,
        barber_id: barber.id, // isolamento multi-tenant
        barbershop_id: barbershopId,
      };
      if (editing) {
        const { error } = await supabase
          .from("clients")
          .update(payload)
          .eq("id", editing.id)
          .eq("barber_id", barber.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado");
      reset();
      qc.invalidateQueries({ queryKey: ["clients", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", id)
        .eq("barber_id", barber.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente removido");
      qc.invalidateQueries({ queryKey: ["clients", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(c: Client) {
    setEditing(c);
    setName(c.name);
    setEmail(c.email ?? "");
    setWhatsapp(c.whatsapp ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filtered = (q.data ?? []).filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(s) ||
      (c.email ?? "").toLowerCase().includes(s) ||
      (c.whatsapp ?? "").includes(s)
    );
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Meus clientes</h1>
        <p className="text-sm text-muted-foreground">
          Cadastre e gerencie a base de clientes da sua barbearia.
        </p>
      </header>

      <section className="surface space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {editing ? "Editar cliente" : "Novo cliente"}
          </h2>
          {editing && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X /> Cancelar
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="space-y-1">
            <Label>E-mail</Label>
            <EmailInput value={email} onChange={setEmail} />
          </div>
          <div className="space-y-1">
            <Label>WhatsApp</Label>
            <PhoneInput value={whatsapp} onChange={setWhatsapp} />
          </div>
        </div>
        <Button variant="hero" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
          {editing ? "Salvar alterações" : "Cadastrar"}
        </Button>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <div className="surface flex flex-1 items-center gap-2 px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone"
              className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {filtered.length} de {q.data?.length ?? 0}
          </span>
        </div>

        {q.isLoading && (
          <div className="surface flex items-center justify-center p-8">
            <Loader2 className="animate-spin" />
          </div>
        )}

        {!q.isLoading && filtered.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado.
          </div>
        )}

        <div className="grid gap-2">
          {filtered.map((c) => (
            <div key={c.id} className="surface flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.whatsapp || "sem telefone"} • {c.email || "sem e-mail"}
                </p>
                {c.user_id && (
                  <span className="mt-1 inline-block rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    Conta ativa
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => startEdit(c)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm(`Remover "${c.name}"?`)) remove.mutate(c.id);
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

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useMeBarber } from "@/hooks/use-auth";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailInput } from "@/components/EmailInput";
import { getMyBarbershopId } from "@/lib/barbershop";

export function BarbeirosTab() {
  const qc = useQueryClient();
  const { barber: me } = useMeBarber();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [admin, setAdmin] = useState(false);


  const q = useQuery({
    queryKey: ["barbers-painel", me?.barbershop_id ?? null],
    queryFn: async () => {
      const shopId = me?.barbershop_id ?? (await getMyBarbershopId());
      let query = supabase.from("barbers").select("*").order("name");
      if (shopId) query = query.eq("barbershop_id", shopId);
      const { data, error } = await query;
      if (error) throw error;
      return data as Barber[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (nome.trim().length < 2) throw new Error("Nome muito curto");
      if (!email.includes("@")) throw new Error("E-mail inválido");
      if (senha.length < 6) throw new Error("Senha precisa de 6+ caracteres");

      const adminSession = (await supabase.auth.getSession()).data.session;
      const adminUserId = adminSession?.user.id;
      if (!adminUserId) throw new Error("Sessão de admin não encontrada");

      // Busca barbershop_id: primeiro no perfil do admin logado (profiles.id = auth.uid()),
      // com fallback para o registro do próprio admin em barbers (caso RLS bloqueie profiles).
      let barbershopId: string | null = null;

      const { data: profile, error: profErr } = await supabase
        .from("profiles" as never)
        .select("barbershop_id")
        .eq("id", adminUserId)
        .maybeSingle();
      if (!profErr && profile) {
        barbershopId = (profile as { barbershop_id?: string | null }).barbershop_id ?? null;
      }

      if (!barbershopId) {
        const { data: myBarber } = await supabase
          .from("barbers")
          .select("barbershop_id" as never)
          .eq("user_id", adminUserId)
          .not("barbershop_id" as never, "is", null)
          .limit(1)
          .maybeSingle();
        barbershopId = (myBarber as { barbershop_id?: string | null } | null)?.barbershop_id ?? null;
      }

      if (!barbershopId) {
        throw new Error(
          "Não foi possível ler o barbershop_id do seu perfil. Verifique as políticas RLS da tabela profiles (SELECT WHERE id = auth.uid()).",
        );
      }


      const { data: signUp, error: suErr } = await supabase.auth.signUp({
        email,
        password: senha,
        options: {
          emailRedirectTo: window.location.origin,
          data: { name: nome.trim(), full_name: nome.trim() },
        },
      });
      if (suErr) throw suErr;
      const newUserId = signUp.user?.id;
      if (!newUserId) throw new Error("Falha ao criar usuário");

      if (adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
      }

      const { data: updatedRows, error: updErr } = await supabase
        .from("barbers")
        .update({ name: nome.trim(), is_admin: admin, barbershop_id: barbershopId } as never)
        .eq("user_id", newUserId)
        .select("id");
      if (updErr) throw updErr;

      if (!updatedRows?.length) {
        const { error: insErr } = await supabase.from("barbers").insert({
          user_id: newUserId,
          name: nome.trim(),
          is_admin: admin,
          barbershop_id: barbershopId,
        } as never);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      toast.success("Barbeiro cadastrado", {
        description: "Ele já pode entrar com o e-mail e a senha definidos.",
      });
      setNome("");
      setEmail("");
      setSenha("");
      setAdmin(false);
      qc.invalidateQueries({ queryKey: ["barbers-painel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAdmin = useMutation({
    mutationFn: async (b: Barber) => {
      const { error } = await supabase
        .from("barbers")
        .update({ is_admin: !b.is_admin })
        .eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["barbers-painel"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (b: Barber) => {
      const { data, error } = await supabase.functions.invoke("delete-barber-user", {
        body: { barber_id: b.id },
      });
      if (error) {
        // Fallback: at least remove the barbers row so the UI stays consistent.
        const { error: delErr } = await supabase.from("barbers").delete().eq("id", b.id);
        if (delErr) throw error;
        throw new Error(
          "Barbeiro removido da equipe, mas o login não pôde ser apagado automaticamente. Faça o deploy da Edge Function 'delete-barber-user' no Supabase.",
        );
      }
      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(String((data as { error: unknown }).error));
      }
    },
    onSuccess: () => {
      toast.success("Barbeiro excluído");
      qc.invalidateQueries({ queryKey: ["barbers-painel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <div className="space-y-6">
      <section className="surface p-4">
        <h2 className="mb-3 font-semibold">Cadastrar novo barbeiro</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do profissional" />
          </div>
          <div className="space-y-1">
            <Label>E-mail (login)</Label>
            <EmailInput value={email} onChange={setEmail} />
          </div>
          <div className="space-y-1">
            <Label>Senha temporária</Label>
            <Input
              type="text"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="ao menos 6 caracteres"
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={admin}
              onChange={(e) => setAdmin(e.target.checked)}
              className="size-4 accent-[color:var(--brand-from)]"
            />
            Conceder privilégios de admin
          </label>
        </div>
        <Button
          variant="hero"
          className="mt-4"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Cadastrar
        </Button>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Equipe
        </h2>
        <div className="grid grid-cols-1 gap-2">
          {q.data?.map((b) => (
            <div key={b.id} className="surface flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white">
                  {b.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold">
                    {b.name}
                    {b.is_admin && (
                      <span className="brand-gradient ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Admin
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b.user_id ? "Conta ativa" : "Sem login vinculado"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => toggleAdmin.mutate(b)}>
                  {b.is_admin ? <ShieldOff /> : <ShieldCheck />}
                  {b.is_admin ? "Revogar admin" : "Tornar admin"}
                </Button>
                {me?.id !== b.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm(`Excluir o barbeiro "${b.name}"? Esta ação não pode ser desfeita.`)) {
                        remove.mutate(b);
                      }
                    }}
                    disabled={remove.isPending}
                  >
                    <Trash2 /> Excluir
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

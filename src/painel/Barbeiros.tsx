import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barbeiro } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailInput } from "@/components/EmailInput";

export function BarbeirosTab() {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [admin, setAdmin] = useState(false);

  const q = useQuery({
    queryKey: ["barbeiros-painel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbeiros")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data as Barbeiro[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (nome.trim().length < 2) throw new Error("Nome muito curto");
      if (!email.includes("@")) throw new Error("E-mail inválido");
      if (senha.length < 6) throw new Error("Senha precisa de 6+ caracteres");

      // Sign up the user via Supabase auth (RLS allows authenticated admin to insert into barbeiros).
      // Note: signUp creates the user but the current admin session remains because we don't
      // call signInWithPassword for the new user; however supabase-js v2 may temporarily switch
      // the session. We'll restore by reading current session afterward.
      const adminSession = (await supabase.auth.getSession()).data.session;

      const { data: signUp, error: suErr } = await supabase.auth.signUp({
        email,
        password: senha,
        options: { emailRedirectTo: window.location.origin },
      });
      if (suErr) throw suErr;
      const newUserId = signUp.user?.id;
      if (!newUserId) throw new Error("Falha ao criar usuário");

      // Restore admin session before inserting (signUp may have replaced session)
      if (adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
      }

      const { error: insErr } = await supabase.from("barbeiros").insert({
        user_id: newUserId,
        nome: nome.trim(),
        is_admin: admin,
      });
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      toast.success("Barbeiro cadastrado", {
        description: "Ele já pode entrar com o e-mail e a senha definidos.",
      });
      setNome("");
      setEmail("");
      setSenha("");
      setAdmin(false);
      qc.invalidateQueries({ queryKey: ["barbeiros-painel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAdmin = useMutation({
    mutationFn: async (b: Barbeiro) => {
      const { error } = await supabase
        .from("barbeiros")
        .update({ is_admin: !b.is_admin })
        .eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["barbeiros-painel"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <section className="surface p-4">
        <h2 className="mb-3 font-semibold">Cadastrar novo barbeiro</h2>
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="grid gap-2">
          {q.data?.map((b) => (
            <div key={b.id} className="surface flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white">
                  {b.nome.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold">
                    {b.nome}
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
              <Button variant="outline" size="sm" onClick={() => toggleAdmin.mutate(b)}>
                {b.is_admin ? <ShieldOff /> : <ShieldCheck />}
                {b.is_admin ? "Revogar admin" : "Tornar admin"}
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, KeyRound, Save } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";

const schema = z
  .object({
    password: z.string().min(6, "A nova senha deve ter ao menos 6 caracteres"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não coincidem",
    path: ["confirm"],
  });

export function PerfilTab({ barber, email }: { barber: Barber; email: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse({ password, confirm });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Senha atualizada");
      setPassword("");
      setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">
          Informações da sua conta e segurança.
        </p>
      </header>

      <section className="surface space-y-2 p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Nome</p>
        <p className="font-semibold">{barber.name}</p>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">E-mail</p>
        <p className="break-all text-sm">{email ?? "—"}</p>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">Perfil</p>
        <p className="text-sm">{barber.is_admin ? "Administrador" : "Barbeiro"}</p>
      </section>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="text-muted-foreground" size={18} />
          <h2 className="font-semibold">Trocar senha</h2>
        </div>
        <div className="space-y-2">
          <Label htmlFor="newpass">Nova senha</Label>
          <PasswordInput
            id="newpass"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmpass">Confirmar nova senha</Label>
          <PasswordInput
            id="confirmpass"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          variant="hero"
          onClick={() => change.mutate()}
          disabled={change.isPending || !password || !confirm}
        >
          {change.isPending ? <Loader2 className="animate-spin" /> : <Save />} Atualizar senha
        </Button>
      </section>
    </div>
  );
}

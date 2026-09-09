import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, KeyRound } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { isClientAccount } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { BrandTitle } from "@/components/Brand";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({ meta: [{ title: "Redefinir senha — VIP BARBER" }] }),
  validateSearch: (s: Record<string, unknown>): { barbershop_id?: string; shop?: string } => ({
    barbershop_id: typeof s.barbershop_id === "string" ? s.barbershop_id : undefined,
    shop: typeof s.shop === "string" ? s.shop : undefined,
  }),
  component: RedefinirSenhaPage,
});

const schema = z
  .object({
    password: z.string().min(6, "A nova senha deve ter ao menos 6 caracteres"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não coincidem",
    path: ["confirm"],
  });

function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const { barbershop_id, shop } = Route.useSearch();
  // "checking" enquanto o Supabase ainda está processando o link do e-mail
  // (detectSessionInUrl faz isso sozinho, mas leva um instante); "ready" só
  // depois de confirmar que é mesmo um link de recuperação válido.
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStatus("ready");
    });
    // Se o link já foi processado antes deste efeito montar (ex.: recarregou
    // a página), o evento PASSWORD_RECOVERY não dispara de novo — confere se
    // já existe uma sessão válida como segunda checagem.
    const timeout = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setStatus((current) => (current === "checking" ? (data.session ? "ready" : "invalid") : current));
    }, 2500);
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  async function routeByRole() {
    const { data: userData } = await supabase.auth.getUser();
    if (isClientAccount(userData.user ? { user: userData.user } : null)) {
      navigate({ to: "/meus-agendamentos" });
      return;
    }
    const { data: b } = await supabase
      .from("barbers")
      .select("id")
      .eq("user_id", userData.user?.id ?? "")
      .limit(1)
      .maybeSingle();
    if (b) {
      try {
        localStorage.setItem("known_barber_device", "1");
      } catch {
        /* ignore */
      }
    }
    navigate({ to: b ? "/painel" : "/meus-agendamentos" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível redefinir a senha", { description: error.message });
      return;
    }
    toast.success("Senha redefinida!");
    await routeByRole();
  }

  const authSearch = barbershop_id ? { barbershop_id } : shop ? { shop } : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <BrandTitle>VIP BARBER</BrandTitle>
        <p className="mt-2 text-sm text-muted-foreground">Redefinir senha</p>
      </div>

      <div className="surface mt-8 space-y-5 p-6">
        {status === "checking" && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            Verificando o link de redefinição…
          </div>
        )}

        {status === "invalid" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Este link de redefinição é inválido ou já expirou. Solicite um novo na tela de login.
            </p>
            <Button asChild variant="hero" className="w-full">
              <Link to="/auth" search={authSearch}>
                Voltar para o login
              </Link>
            </Button>
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="size-4" /> Escolha sua nova senha
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <PasswordInput
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar nova senha</Label>
              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" variant="hero" size="lg" className="w-full" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : "Salvar nova senha"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

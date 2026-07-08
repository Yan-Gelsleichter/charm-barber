import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandTitle } from "@/components/Brand";
import { EmailInput } from "@/components/EmailInput";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — VIP BARBER" }] }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const barberName = name.trim();
    if (mode === "signup" && barberName.length < 2) {
      toast.error("Informe seu nome");
      return;
    }
    setLoading(true);
    async function routeByRole(userId: string) {
      const { data: b } = await supabase
        .from("barbers")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      navigate({ to: b ? "/painel" : "/meus-agendamentos" });
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/meus-agendamentos",
          data: { name: barberName, full_name: barberName },
        },
      });
      setLoading(false);
      if (error) {
        toast.error("Não foi possível criar conta", { description: error.message });
        return;
      }
      if (data.session && data.user) {
        toast.success("Conta criada! Bem-vindo.");
        await routeByRole(data.user.id);
      } else {
        toast.success("Conta criada", {
          description: "Verifique seu e-mail para confirmar (ou desative a confirmação no painel do Cloud).",
        });
        setName("");
        setMode("signin");
      }
      return;
    }
    const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    toast.success("Bem-vindo!");
    if (signIn.user) await routeByRole(signIn.user.id);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <BrandTitle />
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "signin" ? "Seja bem-vindo" : "Criar nova conta"}
        </p>
      </div>

      <form onSubmit={onSubmit} className="surface mt-8 space-y-5 p-6">
        {mode === "signup" && (
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <EmailInput id="email" value={email} onChange={setEmail} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : mode === "signin" ? "Entrar" : "Criar conta"}
        </Button>
        <div className="space-y-3 text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="brand-text font-semibold underline-offset-2 hover:underline"
          >
            {mode === "signin" ? "Não tem conta? Criar agora" : "Já tenho conta — entrar"}
          </button>
          <p>
            Voltar para{" "}
            <Link to="/" className="brand-text font-semibold">
              agendamento
            </Link>
            .
          </p>
        </div>
      </form>
    </main>
  );
}

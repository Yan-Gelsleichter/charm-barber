import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AppBackground } from "@/components/AppBackground";
import { LOGIN_BG_URL } from "@/lib/backgrounds";
import { BrandTitle } from "@/components/Brand";
import { EmailInput } from "@/components/EmailInput";
import { PasswordInput } from "@/components/PasswordInput";
import { ExcluirContaSection } from "@/components/ExcluirContaSection";

export const Route = createFileRoute("/excluir-dados")({
  head: () => ({ meta: [{ title: "Excluir meus dados — APP BARBEARIAS" }] }),
  component: ExcluirDadosPage,
});

const SUPPORT_EMAIL = "appbarbeariassuporte@gmail.com";

const signInSchema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

/**
 * Página pública de exclusão de conta — exigência da Play Store, além do
 * caminho dentro do app (Perfil/`meus-agendamentos`). Sem sessão, pede login
 * primeiro (mesmos métodos de `auth.tsx`); com sessão, mostra o mesmo
 * `ExcluirContaSection` usado no app.
 */
function ExcluirDadosPage() {
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSigningIn(false);
    if (error) toast.error("Não foi possível entrar", { description: error.message });
  }

  async function onGoogle() {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/excluir-dados" },
    });
    if (error) {
      setGoogleLoading(false);
      toast.error("Não foi possível entrar com Google", { description: error.message });
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <AppBackground src={LOGIN_BG_URL} />
      <div className="text-center">
        <BrandTitle>APP BARBEARIAS</BrandTitle>
        <p className="mt-2 text-sm text-muted-foreground">Excluir meus dados</p>
      </div>

      {!session ? (
        <>
          <p className="mt-4 text-center text-xs text-muted-foreground md:text-sm">
            Entre com a conta que você quer excluir.
          </p>
          <form onSubmit={onSubmit} className="auth-glass mt-6 space-y-5 rounded-2xl p-6">
            <div className="space-y-2">
              <Label htmlFor="excluir-email">E-mail</Label>
              <EmailInput id="excluir-email" value={email} onChange={setEmail} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="excluir-password">Senha</Label>
              <PasswordInput
                id="excluir-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" variant="hero" size="lg" className="w-full" disabled={signingIn}>
              {signingIn ? <Loader2 className="animate-spin" /> : "Entrar"}
            </Button>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              ou
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={onGoogle}
              disabled={googleLoading}
            >
              {googleLoading ? <Loader2 className="animate-spin" /> : null}
              Continuar com Google
            </Button>
          </form>
        </>
      ) : (
        <div className="mt-6">
          <ExcluirContaSection redirectTo="/excluir-dados" />
        </div>
      )}

      <div className="mt-8 space-y-1 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1">
          <Mail className="size-3.5" /> Não consegue entrar? Escreva para{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="brand-text font-semibold">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  );
}

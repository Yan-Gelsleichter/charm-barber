import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { isClientAccount } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandTitle } from "@/components/Brand";
import { EmailInput } from "@/components/EmailInput";
import { PasswordInput } from "@/components/PasswordInput";
import { PhoneInput } from "@/components/PhoneInput";
import { phoneDigits } from "@/lib/format";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — VIP BARBER" }] }),
  component: AuthPage,
});

const signInSchema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [invitedShopId, setInvitedShopId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("barbershop_id") || params.get("shop");
    if (sid) {
      try {
        sessionStorage.setItem("invite_barbershop_id", sid);
      } catch {
        /* ignore */
      }
      setInvitedShopId(sid);
      setMode("signup");
    } else {
      try {
        const stored = sessionStorage.getItem("invite_barbershop_id");
        if (stored) setInvitedShopId(stored);
      } catch {
        /* ignore */
      }
    }
  }, []);

  async function routeByRole(userId: string) {
    const { data: userData } = await supabase.auth.getUser();
    if (isClientAccount(userData.user ? { user: userData.user } : null)) {
      navigate({ to: "/meus-agendamentos" });
      return;
    }
    const { data: b } = await supabase
      .from("barbers")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    navigate({ to: b ? "/painel" : "/meus-agendamentos" });
  }

  async function onGoogle() {
    setGoogleLoading(true);
    const shopParam = invitedShopId ? `&barbershop_id=${encodeURIComponent(invitedShopId)}` : "";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/meus-agendamentos?cliente=1" + shopParam,
      },
    });
    if (error) {
      setGoogleLoading(false);
      toast.error("Não foi possível entrar com Google", { description: error.message });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (mode === "signup") {
      if (name.trim().length < 2) {
        toast.error("Informe seu nome");
        return;
      }
      if (phoneDigits(whatsapp).length < 10) {
        toast.error("Informe um WhatsApp válido");
        return;
      }
    }
    setLoading(true);

    if (mode === "signup") {
      const digits = phoneDigits(whatsapp);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/",
          data: {
            account_type: "client",
            name: name.trim(),
            full_name: name.trim(),
            whatsapp: digits,
            whatsapp_masked: whatsapp,
            whatsapp_digits: digits,
            phone: digits,
          },
        },
      });
      setLoading(false);
      if (error) {
        toast.error("Não foi possível criar conta", { description: error.message });
        return;
      }
      if (data.session && data.user) {
        await supabase.auth.updateUser({
          data: {
            account_type: "client",
            name: name.trim(),
            full_name: name.trim(),
            whatsapp: digits,
            whatsapp_masked: whatsapp,
            whatsapp_digits: digits,
            phone: digits,
          },
        });
        await supabase.from("barbers").delete().eq("user_id", data.user.id);
        toast.success("Conta criada! Bem-vindo.");

        navigate({ to: "/" });
      } else {
        toast.success("Conta criada", {
          description: "Verifique seu e-mail para confirmar o cadastro.",
        });
        setName("");
        setWhatsapp("");
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

  const isSignup = mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <BrandTitle />
        <p className="mt-2 text-sm text-muted-foreground">
          {isSignup ? "Criar conta de cliente" : "Entrar na sua conta"}
        </p>
      </div>

      <form onSubmit={onSubmit} className="surface mt-8 space-y-5 p-6">
        {isSignup && (
          <>
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <PhoneInput id="whatsapp" value={whatsapp} onChange={setWhatsapp} />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <EmailInput id="email" value={email} onChange={setEmail} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : isSignup ? "Criar conta" : "Entrar"}
        </Button>

        <div className="relative py-1 text-center">
          <span className="relative z-10 bg-card px-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            ou
          </span>
          <span className="absolute left-0 right-0 top-1/2 -z-0 h-px bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={onGoogle}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.1z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.9 35 44 30 44 24c0-1.2-.1-2.3-.4-3.5z"/>
            </svg>
          )}
          Continuar com Google
        </Button>

        <div className="space-y-3 text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setMode(isSignup ? "signin" : "signup")}
            className="brand-text font-semibold underline-offset-2 hover:underline"
          >
            {isSignup ? "Já tenho conta — entrar" : "Não tem conta? Criar agora"}
          </button>
          {!isSignup && (
            <p className="text-[11px]">
              Barbeiros: use o mesmo formulário para entrar. Cadastro de barbeiro é feito pelo admin.
            </p>
          )}
          <p>
            Voltar para{" "}
            <Link to="/" className="brand-text font-semibold">
              início
            </Link>
            .
          </p>
        </div>
      </form>
    </main>
  );
}

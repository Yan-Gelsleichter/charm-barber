import { useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandTitle } from "@/components/Brand";
import { EmailInput } from "@/components/EmailInput";
import { PasswordInput } from "@/components/PasswordInput";
import { PhoneInput } from "@/components/PhoneInput";
import { postPublicApi } from "@/lib/api-fetch";
import { phoneDigits } from "@/lib/format";

export const Route = createFileRoute("/comecar")({
  head: () => ({ meta: [{ title: "Comece grátis — VIP BARBER" }] }),
  component: ComecarPage,
});

function ComecarPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Informe seu nome");
      return;
    }
    if (businessName.trim().length < 2) {
      toast.error("Informe o nome da sua barbearia");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error("Informe um e-mail válido");
      return;
    }
    if (password.length < 6) {
      toast.error("A senha deve ter ao menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      // Se um envio anterior já criou a conta mas falhou ao criar a
      // barbearia (ex.: queda de conexão), reenviar o formulário reaproveita
      // a sessão já aberta em vez de tentar cadastrar o e-mail de novo.
      let session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        const digits = phoneDigits(whatsapp);
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin + "/painel",
            data: {
              name: name.trim(),
              full_name: name.trim(),
              ...(digits ? { whatsapp: digits, whatsapp_digits: digits, phone: digits } : {}),
            },
          },
        });
        if (error) {
          toast.error("Não foi possível criar sua conta", { description: error.message });
          return;
        }
        if (!data.session) {
          toast.success("Conta criada!", {
            description: "Verifique seu e-mail para confirmar o cadastro e depois entre para continuar.",
          });
          return;
        }
        session = data.session;
      }

      const result = await postPublicApi<{ barbershop_id?: string; error?: string }>(
        "/api/public/create-barbershop",
        { name: name.trim(), business_name: businessName.trim() },
        session.access_token,
      );
      if (!result?.barbershop_id) {
        throw new Error(result?.error ?? "Não foi possível concluir o cadastro.");
      }

      toast.success("Sua barbearia foi criada!", { description: "7 dias grátis começam agora." });
      navigate({ to: "/painel" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir o cadastro.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="text-center">
        <BrandTitle>VIP BARBER</BrandTitle>
        <p className="mt-2 text-sm text-muted-foreground">Cadastre sua barbearia</p>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-brand-from/30 bg-brand-from/10 p-3 text-center text-sm font-medium">
        <Sparkles className="size-4 shrink-0 text-[var(--brand-from)]" />
        7 dias grátis, sem cartão de crédito
      </div>

      <form onSubmit={onSubmit} className="surface mt-6 space-y-5 p-6">
        <div className="space-y-2">
          <Label htmlFor="name">Seu nome</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="business-name">Nome da barbearia</Label>
          <Input
            id="business-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Ex.: Barbearia do João"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
          <PhoneInput id="whatsapp" value={whatsapp} onChange={setWhatsapp} />
        </div>
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
          {loading ? <Loader2 className="animate-spin" /> : "Começar meu teste grátis"}
        </Button>

        <div className="space-y-3 text-center text-xs text-muted-foreground">
          <p>
            Já tem uma barbearia cadastrada?{" "}
            <Link to="/auth" className="brand-text font-semibold">
              Entrar
            </Link>
          </p>
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

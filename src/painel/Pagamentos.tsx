import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wallet,
  Split,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  envClientId,
  mpAuthUrl,
  mpRedirectUri,
  saveClientId,
  storedClientId,
  type PayoutMode,
} from "@/lib/mercadopago";

type ShopRow = {
  mp_user_id?: string | null;
  payout_mode?: string | null;
};

const MODES: { id: PayoutMode; title: string; desc: string; icon: React.ElementType }[] = [
  {
    id: "unica",
    title: "Conta única (padrão)",
    desc: "Todo o dinheiro dos agendamentos cai na conta principal da barbearia. O acerto das comissões é feito por fora.",
    icon: Wallet,
  },
  {
    id: "split",
    title: "Split por subcontas",
    desc: "Cada barbeiro conecta a própria conta do Mercado Pago (aba Pagamentos em Barbeiros) e recebe sua parte direto no split.",
    icon: Split,
  },
];

export function PagamentosTab({ barber }: { barber: Barber }) {
  const shopId = barber.barbershop_id ?? null;
  const qc = useQueryClient();
  const [clientId, setClientId] = useState(() => envClientId() || storedClientId());
  const [mode, setMode] = useState<PayoutMode>("unica");
  const redirectUri = mpRedirectUri();

  const statusQ = useQuery({
    queryKey: ["mp-status", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const full = await supabase
        .from("barbershops" as never)
        .select("id, mp_user_id, payout_mode")
        .eq("id", shopId!)
        .maybeSingle();
      if (!full.error) return (full.data as ShopRow | null) ?? null;
      // Coluna payout_mode ainda não existe no banco.
      const { data, error } = await supabase
        .from("barbershops" as never)
        .select("id, mp_user_id")
        .eq("id", shopId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ShopRow | null) ?? null;
    },
  });

  useEffect(() => {
    const saved = statusQ.data?.payout_mode;
    if (saved === "split" || saved === "unica") setMode(saved);
  }, [statusQ.data?.payout_mode]);

  const saveMode = useMutation({
    mutationFn: async (next: PayoutMode) => {
      if (!shopId) throw new Error("Sua conta não está vinculada a uma barbearia");
      const { error } = await supabase
        .from("barbershops" as never)
        .update({ payout_mode: next } as never)
        .eq("id", shopId);
      if (error) throw error;
    },
    onSuccess: (_d, next) => {
      toast.success(
        next === "split" ? "Split por subcontas ativado" : "Modelo de conta única ativado",
      );
      qc.invalidateQueries({ queryKey: ["mp-status", shopId] });
      qc.invalidateQueries({ queryKey: ["payout-mode"] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível salvar o modelo", {
        description: `${e.message}. Rode docs/add-payout-mode.sql no Supabase.`,
      }),
  });

  const connected = !!statusQ.data?.mp_user_id;

  function connect() {
    if (!shopId) {
      toast.error("Sua conta não está vinculada a uma barbearia");
      return;
    }
    const id = clientId.trim();
    if (!id) {
      toast.error("Informe o Client ID da sua aplicação no Mercado Pago");
      return;
    }
    saveClientId(id);
    window.location.href = mpAuthUrl(id, shopId);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Pagamentos</h1>
        <p className="text-sm text-muted-foreground">
          Conecte sua conta do Mercado Pago e escolha como o dinheiro é repassado aos profissionais.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div>
          <p className="font-medium">Modelo de repasse financeiro</p>
          <p className="text-xs text-muted-foreground">
            Escolha como os valores dos agendamentos serão distribuídos.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  saveMode.mutate(m.id);
                }}
                disabled={saveMode.isPending}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-colors",
                  active
                    ? "border-[color:var(--brand-from)] bg-[color:var(--brand-from)]/10"
                    : "border-border hover:bg-secondary",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className="size-4" />
                  <span className="text-sm font-semibold">{m.title}</span>
                  {active && <CheckCircle2 className="ml-auto size-4 text-[color:var(--success)]" />}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{m.desc}</p>
              </button>
            );
          })}
        </div>

        {mode === "split" && (
          <p className="rounded-lg border border-brand-from/30 bg-brand-from/10 p-3 text-xs text-muted-foreground">
            Ativo: a aba <span className="font-semibold text-foreground">Pagamentos</span> na tela de
            Barbeiros permite conectar a conta Mercado Pago de cada profissional.
          </p>
        )}
      </section>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-3">
          <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <CreditCard className="size-5" />
          </div>
          <div className="flex-1">
            <p className="font-medium">Mercado Pago da barbearia</p>
            {statusQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Verificando…</p>
            ) : connected ? (
              <p className="flex items-center gap-1 text-xs text-[color:var(--success)]">
                <CheckCircle2 className="size-3" /> Conectado (conta {statusQ.data?.mp_user_id})
              </p>
            ) : (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <AlertCircle className="size-3" /> Não conectado
              </p>
            )}
          </div>
        </div>

        {!envClientId() && (
          <div className="space-y-1">
            <Label htmlFor="mpclient">Client ID da aplicação Mercado Pago</Label>
            <Input
              id="mpclient"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Ex.: 1234567890123456"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label>Redirect URI (cadastre no painel do Mercado Pago)</Label>
          <p className="break-all rounded-lg bg-secondary p-3 font-mono text-xs">{redirectUri}</p>
        </div>

        <Button variant="hero" onClick={connect} disabled={statusQ.isLoading || !shopId}>
          {statusQ.isFetching ? <Loader2 className="animate-spin" /> : <ExternalLink />}
          {connected ? "Reconectar com Mercado Pago" : "Conectar com Mercado Pago"}
        </Button>
      </section>
    </div>
  );
}

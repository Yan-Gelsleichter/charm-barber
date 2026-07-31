import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, ExternalLink, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CLIENT_ID_KEY = "mp_client_id";

function envClientId() {
  return (import.meta.env.VITE_MP_CLIENT_ID as string | undefined)?.trim() || "";
}

function storedClientId() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(CLIENT_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function PagamentosTab({ barber }: { barber: Barber }) {
  const shopId = barber.barbershop_id ?? null;
  const [clientId, setClientId] = useState(() => envClientId() || storedClientId());

  const redirectUri = useMemo(() => {
    const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    return `${base}/functions/v1/mercadopago-oauth`;
  }, []);

  const statusQ = useQuery({
    queryKey: ["mp-status", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbershops" as never)
        .select("id, mp_user_id")
        .eq("id", shopId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { mp_user_id?: string | null } | null) ?? null;
    },
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
    try {
      localStorage.setItem(CLIENT_ID_KEY, id);
    } catch {
      /* ignore */
    }
    const url =
      `https://auth.mercadopago.com/authorization?client_id=${encodeURIComponent(id)}` +
      `&response_type=code&platform_id=mp&state=${encodeURIComponent(shopId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    window.location.href = url;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Pagamentos</h1>
        <p className="text-sm text-muted-foreground">
          Conecte sua conta do Mercado Pago para receber pagamentos por PIX direto dos clientes.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-3">
          <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <CreditCard className="size-5" />
          </div>
          <div className="flex-1">
            <p className="font-medium">Mercado Pago</p>
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

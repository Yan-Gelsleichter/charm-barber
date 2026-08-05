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
  Unlink,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
    desc: "Cada barbeiro conecta a própria conta do Mercado Pago no painel dele e recebe sua parte direto no split.",
    icon: Split,
  },
];

export function PagamentosTab({ barber }: { barber: Barber }) {
  if (!barber.is_admin) return <MeuMercadoPago barber={barber} />;
  return <AdminPagamentos barber={barber} />;
}

/** Tela do barbeiro (funcionário): conecta a própria conta no modo split. */
function MeuMercadoPago({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState(() => envClientId() || storedClientId());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const meQ = useQuery({
    queryKey: ["mp-status-barber", barber.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbers")
        .select("id, mp_user_id")
        .eq("id", barber.id)
        .maybeSingle();
      if (error) throw error;
      return (data as { mp_user_id?: string | null } | null) ?? null;
    },
  });
  const connected = !!meQ.data?.mp_user_id;

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("barbers")
        .update({
          mp_user_id: null,
          mp_access_token: null,
          mp_refresh_token: null,
        } as never)
        .eq("id", barber.id)
        .select("id, mp_user_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Sem permissão para desconectar esta conta");
      return data as { mp_user_id?: string | null };
    },
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("Conta Mercado Pago desconectada");
      qc.invalidateQueries({ queryKey: ["mp-status-barber", barber.id] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível desconectar", { description: e.message }),
  });

  function connect() {
    const id = clientId.trim();
    if (!id) {
      toast.error("Informe o Client ID da aplicação no Mercado Pago");
      return;
    }
    saveClientId(id);
    window.location.href = mpAuthUrl(id, `barber:${barber.id}`);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Pagamentos</h1>
        <p className="text-sm text-muted-foreground">
          Conecte sua conta do Mercado Pago para receber sua parte diretamente pelo split.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-3">
          <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <CreditCard className="size-5" />
          </div>
          <div className="flex-1">
            <p className="font-medium">Minha conta Mercado Pago</p>
            {meQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Verificando…</p>
            ) : meQ.isError ? (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="size-3" /> Erro ao verificar a conexão
              </p>
            ) : connected ? (
              <p className="flex items-center gap-1 text-xs text-[color:var(--success)]">
                <CheckCircle2 className="size-3" /> Conectada (conta {meQ.data?.mp_user_id})
              </p>
            ) : (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <AlertCircle className="size-3" /> Não conectada
              </p>
            )}
          </div>
        </div>

        {!envClientId() && (
          <div className="space-y-1">
            <Label htmlFor="mpclientbarber">Client ID da aplicação Mercado Pago</Label>
            <Input
              id="mpclientbarber"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Ex.: 1234567890123456"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label>Redirect URI</Label>
          <p className="break-all rounded-lg bg-secondary p-3 font-mono text-xs">{mpRedirectUri()}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="hero" onClick={connect} disabled={meQ.isLoading || disconnect.isPending}>
            {meQ.isFetching ? <Loader2 className="animate-spin" /> : <ExternalLink />}
            {connected ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}
          </Button>

          {connected && (
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? <Loader2 className="animate-spin" /> : <Unlink />}
              Desconectar
            </Button>
          )}
        </div>

        {meQ.isError && (
          <Button variant="ghost" size="sm" onClick={() => meQ.refetch()}>
            Tentar novamente
          </Button>
        )}
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar Mercado Pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Você deixará de receber sua parte automaticamente pelo split até conectar a conta
              novamente. Os pagamentos passarão a cair na conta principal da barbearia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnect.mutate();
              }}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Desconectando…" : "Desconectar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AdminPagamentos({ barber }: { barber: Barber }) {
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
      const { data, error } = await supabase
        .from("barbershops" as never)
        .update({ payout_mode: next } as never)
        .eq("id", shopId)
        .select("id, payout_mode")
        .maybeSingle();
      if (error) throw error;
      // Sem linha retornada = update bloqueado por RLS (nada foi salvo).
      if (!data) throw new Error("Sem permissão para alterar esta barbearia");
      return (data as ShopRow).payout_mode === "split" ? "split" : "unica";
    },
    onSuccess: (saved: PayoutMode) => {
      setMode(saved);
      toast.success(
        saved === "split" ? "Split por subcontas ativado" : "Modelo de conta única ativado",
      );
      qc.setQueryData(["payout-mode", shopId], saved);
      qc.setQueryData(["mp-status", shopId], (prev: ShopRow | null | undefined) =>
        prev ? { ...prev, payout_mode: saved } : prev,
      );
      qc.invalidateQueries({ queryKey: ["mp-status", shopId] });
      qc.invalidateQueries({ queryKey: ["payout-mode"] });
    },
    onError: (e: Error) => {
      const saved = statusQ.data?.payout_mode;
      setMode(saved === "split" ? "split" : "unica");
      toast.error("Não foi possível salvar o modelo", {
        description: `${e.message}. Rode docs/add-payout-mode.sql no Supabase.`,
      });
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
            Ativo: cada barbeiro vê a aba <span className="font-semibold text-foreground">Pagamentos</span>{" "}
            no próprio painel e conecta a conta Mercado Pago dele por lá.
          </p>
        )}
      </section>

      {mode === "split" && <ComissoesBarbeiros shopId={shopId} />}


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

      <ChavesManuais shopId={shopId} />
    </div>
  );
}

/** Permite colar manualmente Public Key e Access Token do Mercado Pago da barbearia. */
function ChavesManuais({ shopId }: { shopId: string | null }) {
  const qc = useQueryClient();
  const [publicKey, setPublicKey] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const keysQ = useQuery({
    queryKey: ["mp-keys", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbershops" as never)
        .select("id, mp_public_key")
        .eq("id", shopId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { mp_public_key?: string | null } | null) ?? null;
    },
  });

  useEffect(() => {
    setPublicKey(keysQ.data?.mp_public_key ?? "");
  }, [keysQ.data?.mp_public_key]);

  const save = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new Error("Sua conta não está vinculada a uma barbearia");
      const pk = publicKey.trim();
      const at = accessToken.trim();
      if (!pk && !at) throw new Error("Informe a Public Key e/ou o Access Token");
      const payload: Record<string, string> = {};
      if (pk) payload["mp_public_key"] = pk;
      if (at) payload["mp_access_token"] = at;
      const { data, error } = await supabase
        .from("barbershops" as never)
        .update(payload as never)
        .eq("id", shopId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Sem permissão para alterar esta barbearia");
    },
    onSuccess: () => {
      setAccessToken("");
      toast.success("Chaves do Mercado Pago salvas");
      qc.invalidateQueries({ queryKey: ["mp-keys", shopId] });
      qc.invalidateQueries({ queryKey: ["mp-status", shopId] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível salvar as chaves", { description: e.message }),
  });

  return (
    <section className="surface space-y-4 p-4">
      <div>
        <p className="font-medium">Chaves do Mercado Pago (manual)</p>
        <p className="text-xs text-muted-foreground">
          Cole aqui as credenciais da sua conta. A Public Key é usada para abrir o formulário de
          cartão dentro do app e o Access Token para cobrar.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="mp-pk">Public Key</Label>
        <Input
          id="mp-pk"
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder="APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="mp-at">Access Token</Label>
        <Input
          id="mp-at"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="APP_USR-0000000000000000-000000-...."
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Por segurança o token não é exibido depois de salvo. Deixe em branco para manter o atual.
        </p>
      </div>

      <Button variant="hero" onClick={() => save.mutate()} disabled={save.isPending || !shopId}>
        {save.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />} Salvar chaves
      </Button>
    </section>
  );
}


type BarberRow = {
  id: string;
  name: string;
  is_admin: boolean;
  mp_user_id: string | null;
  commission_percent: number | null;
};

/** Lista de barbeiros com comissão individual e status de conexão (modo split). */
function ComissoesBarbeiros({ shopId }: { shopId: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const listQ = useQuery({
    queryKey: ["split-barbers", shopId],
    enabled: !!shopId,
    queryFn: async (): Promise<BarberRow[]> => {
      const { data, error } = await supabase
        .from("barbers")
        .select("id, name, is_admin, mp_user_id, commission_percent")
        .eq("barbershop_id", shopId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as BarberRow[];
    },
  });

  const saveCommission = useMutation({
    mutationFn: async ({ id, percent }: { id: string; percent: number }) => {
      const { data, error } = await supabase
        .from("barbers")
        .update({ commission_percent: percent } as never)
        .eq("id", id)
        .select("id, commission_percent")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Sem permissão para alterar este barbeiro");
      return data as { id: string };
    },
    onSuccess: ({ id }) => {
      setDraft((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      toast.success("Comissão salva");
      qc.invalidateQueries({ queryKey: ["split-barbers", shopId] });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível salvar a comissão", { description: e.message }),
  });

  function save(b: BarberRow) {
    const raw = draft[b.id];
    const percent = Number(raw);
    if (raw === undefined || raw === "" || Number.isNaN(percent) || percent < 0 || percent > 100) {
      toast.error("Informe uma porcentagem entre 0 e 100");
      return;
    }
    saveCommission.mutate({ id: b.id, percent });
  }

  return (
    <section className="surface space-y-4 p-4">
      <div>
        <p className="font-medium">Comissões por profissional</p>
        <p className="text-xs text-muted-foreground">
          Defina quanto cada barbeiro recebe do valor do serviço. O restante fica com a barbearia.
        </p>
      </div>

      {listQ.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando barbeiros…
        </p>
      ) : listQ.isError ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="size-4" /> Erro ao carregar os barbeiros
          </p>
          <Button variant="ghost" size="sm" onClick={() => listQ.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !listQ.data?.length ? (
        <p className="text-sm text-muted-foreground">Nenhum barbeiro cadastrado nesta barbearia.</p>
      ) : (
        <ul className="space-y-3">
          {listQ.data.map((b) => {
            const current = draft[b.id] ?? (b.commission_percent ?? "").toString();
            const percent = Number(current);
            const shopShare =
              current !== "" && !Number.isNaN(percent) && percent >= 0 && percent <= 100
                ? 100 - percent
                : null;
            const dirty = draft[b.id] !== undefined;
            return (
              <li key={b.id} className="rounded-2xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {b.name}
                      {b.is_admin && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(admin)</span>
                      )}
                    </p>
                    {b.mp_user_id ? (
                      <p className="flex items-center gap-1 text-xs text-[color:var(--success)]">
                        <CheckCircle2 className="size-3" /> Mercado Pago conectado
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertCircle className="size-3" /> Mercado Pago não conectado
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <Label htmlFor={`c-${b.id}`} className="sr-only">
                        Comissão de {b.name}
                      </Label>
                      <Input
                        id={`c-${b.id}`}
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        value={current}
                        placeholder="%"
                        onChange={(e) => setDraft((d) => ({ ...d, [b.id]: e.target.value }))}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant={dirty ? "hero" : "outline"}
                      onClick={() => save(b)}
                      disabled={!dirty || saveCommission.isPending}
                    >
                      {saveCommission.isPending ? <Loader2 className="animate-spin" /> : null}
                      Salvar
                    </Button>
                  </div>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {shopShare === null
                    ? "Defina a porcentagem do barbeiro (0 a 100)."
                    : `${percent}% do barbeiro / ${shopShare}% da barbearia`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


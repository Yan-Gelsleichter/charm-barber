import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Loader2, Pencil, Star, Trash2, X, Save } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/meus-cartoes")({
  head: () => ({
    meta: [
      { title: "Meus cartões — VIP BARBER" },
      {
        name: "description",
        content: "Gerencie seus cartões salvos: atualize dados, escolha o padrão ou remova.",
      },
      { property: "og:title", content: "Meus cartões — VIP BARBER" },
      {
        property: "og:description",
        content: "Gerencie seus cartões salvos: atualize dados, escolha o padrão ou remova.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MeusCartoesPage,
});

type MyCard = {
  id: string;
  last_four: string | null;
  brand: string | null;
  cardholder_name: string | null;
  expiration_month: number | null;
  expiration_year: number | null;
  is_default?: boolean | null;
};

async function callCardsApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sua sessão expirou. Faça login novamente.");
  const response = await fetch("/api/public/mercadopago-cards", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error ?? "Falha ao processar o cartão.");
  return data;
}

function MeusCartoesPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, loading } = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", expiry: "" });

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const cardsQ = useQuery({
    queryKey: ["my-saved-cards", session?.user.id],
    enabled: !!session,
    queryFn: () => callCardsApi<{ cards: MyCard[] }>({ action: "my_cards" }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["my-saved-cards", session?.user.id] });

  const remove = useMutation({
    mutationFn: (id: string) => callCardsApi<{ ok: boolean }>({ action: "delete", saved_card_id: id }),
    onSuccess: () => {
      toast.success("Cartão removido");
      invalidate();
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) =>
      callCardsApi<{ ok: boolean }>({ action: "set_default", saved_card_id: id }),
    onSuccess: () => {
      toast.success("Cartão padrão atualizado");
      invalidate();
    },
    onError: (e: Error) => toast.error("Não foi possível definir o padrão", { description: e.message }),
  });

  const update = useMutation({
    mutationFn: async (id: string) => {
      const payload: Record<string, unknown> = { action: "update", saved_card_id: id };
      if (form.name.trim().length >= 2) payload["cardholder_name"] = form.name.trim();
      const [mm, yy] = form.expiry.split("/");
      if (mm && yy) {
        const month = Number(mm.replace(/\D/g, ""));
        const digitsYear = yy.replace(/\D/g, "");
        const year = Number(digitsYear.length === 2 ? `20${digitsYear}` : digitsYear);
        if (!month || month < 1 || month > 12) throw new Error("Validade inválida (MM/AA).");
        if (!year || year < 2024) throw new Error("Validade inválida (MM/AA).");
        payload["expiration_month"] = month;
        payload["expiration_year"] = year;
      }
      if (!payload["cardholder_name"] && !payload["expiration_month"]) {
        throw new Error("Informe o nome ou a nova validade.");
      }
      return callCardsApi<{ ok: boolean }>(payload);
    },
    onSuccess: () => {
      toast.success("Cartão atualizado");
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => toast.error("Não foi possível atualizar", { description: e.message }),
  });

  function startEdit(card: MyCard) {
    setEditing(card.id);
    setForm({
      name: card.cardholder_name ?? "",
      expiry:
        card.expiration_month && card.expiration_year
          ? `${String(card.expiration_month).padStart(2, "0")}/${String(card.expiration_year).slice(-2)}`
          : "",
    });
  }

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else navigate({ to: "/meus-agendamentos", search: { cliente: false } });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!session) return null;

  const cards = cardsQ.data?.cards ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Button variant="ghost" size="sm" className="mb-4" onClick={goBack}>
        <ArrowLeft /> Voltar
      </Button>

      <header className="mb-5">
        <h1 className="text-lg font-semibold">Meus cartões</h1>
        <p className="text-sm text-muted-foreground">
          Veja, atualize, escolha o cartão padrão ou remova os cartões salvos.
        </p>
      </header>

      {cardsQ.isLoading && (
        <div className="surface flex items-center justify-center p-8">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {!cardsQ.isLoading && cards.length === 0 && (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Você ainda não tem cartões salvos. Pague um agendamento com cartão e escolha salvar.
        </div>
      )}

      <div className="grid gap-3">
        {cards.map((card) => (
          <section key={card.id} className="surface p-4">
            <div className="flex items-center gap-3">
              <CreditCard className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {card.brand ?? "Cartão"} •••• {card.last_four ?? "0000"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {card.cardholder_name || "Sem nome"}
                  {card.expiration_month && card.expiration_year
                    ? ` • ${String(card.expiration_month).padStart(2, "0")}/${String(card.expiration_year).slice(-2)}`
                    : ""}
                </p>
                {card.is_default && (
                  <span className="mt-1 inline-block rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    Padrão
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Editar cartão"
                onClick={() => (editing === card.id ? setEditing(null) : startEdit(card))}
              >
                {editing === card.id ? <X /> : <Pencil />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remover cartão"
                onClick={() => {
                  if (confirm("Remover este cartão?")) remove.mutate(card.id);
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </div>

            {editing === card.id && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Nome impresso</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nome no cartão"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Validade (MM/AA)</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={5}
                    value={form.expiry}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setForm((f) => ({
                        ...f,
                        expiry: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d,
                      }));
                    }}
                    placeholder="MM/AA"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    variant="hero"
                    onClick={() => update.mutate(card.id)}
                    disabled={update.isPending}
                  >
                    {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                    Salvar alterações
                  </Button>
                </div>
              </div>
            )}

            {!card.is_default && (
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setDefault.mutate(card.id)}
                disabled={setDefault.isPending}
              >
                <Star /> Tornar padrão
              </Button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

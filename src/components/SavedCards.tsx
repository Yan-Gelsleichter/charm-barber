import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Loader2, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SavedCard = {
  id: string;
  last_four: string | null;
  brand: string | null;
  cardholder_name: string | null;
  expiration_month: number | null;
  expiration_year: number | null;
  is_default?: boolean | null;
};

type MpInstance = {
  createCardToken: (data: Record<string, unknown>) => Promise<{ id?: string; error?: unknown }>;
};

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MpInstance;
  }
}

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

function loadMpSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-mp-sdk]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar o Mercado Pago")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.dataset["mpSdk"] = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o Mercado Pago"));
    document.head.appendChild(script);
  });
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

/** Amex usa 4 dígitos; as demais bandeiras usam 3. */
export function cvvLengthFor(brand?: string | null, cardNumber?: string | null) {
  const isAmex =
    (brand ?? "").toLowerCase().includes("amex") ||
    (brand ?? "").toLowerCase().includes("american") ||
    /^3[47]/.test(digits(cardNumber ?? ""));
  return isAmex ? 4 : 3;
}

/** Formata o número do cartão em grupos (4-4-4-4, ou 4-6-5 para Amex). */
export function formatCardNumber(value: string) {
  const d = digits(value).slice(0, 19);
  const amex = /^3[47]/.test(d);
  const groups = amex ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let i = 0;
  for (const size of groups) {
    if (i >= d.length) break;
    parts.push(d.slice(i, i + size));
    i += size;
  }
  return parts.join(" ");
}

/** Algoritmo de Luhn. */
export function luhnValid(value: string) {
  const d = digits(value);
  if (d.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Retorna a mensagem de erro do número do cartão ou null quando válido. */
export function validateCardNumber(value: string) {
  const d = digits(value);
  if (!d) return "Informe o número do cartão.";
  const amex = /^3[47]/.test(d);
  const expected = amex ? 15 : 16;
  if (d.length < expected) return `O número do cartão deve ter ${expected} dígitos.`;
  if (d.length > 19) return "Número do cartão inválido.";
  if (!luhnValid(d)) return "Número do cartão inválido. Confira os dígitos.";
  return null;
}

/** Retorna a mensagem de erro da validade (MM/AA) ou null quando válida. */
export function validateExpiry(value: string, now: Date = new Date()) {
  const d = digits(value);
  if (!d) return "Informe a validade (MM/AA).";
  if (d.length < 4) return "Use o formato MM/AA.";
  const month = Number(d.slice(0, 2));
  if (month < 1 || month > 12) return "Mês inválido. Use de 01 a 12.";
  const rawYear = d.slice(2);
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const expiry = new Date(year, month, 1);
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  if (expiry <= current) return "Cartão vencido. Confira a validade.";
  if (year > now.getFullYear() + 20) return "Validade inválida.";
  return null;
}

/** Retorna a mensagem de erro do CVV ou null quando válido. */
export function validateCvv(value: string, brand?: string | null, cardNumber?: string | null) {
  const raw = value.trim();
  if (!raw) return "Informe o código de segurança (CVV).";
  if (/\D/.test(raw)) return "O CVV deve conter apenas números.";
  const expected = cvvLengthFor(brand, cardNumber);
  if (raw.length !== expected) return `O CVV deve ter ${expected} dígitos.`;
  return null;
}

export function SavedCards({
  appointmentId,
  onPaid,
}: {
  appointmentId: string;
  onPaid: (status: string) => void;
}) {
  const queryClient = useQueryClient();
  const [mp, setMp] = useState<MpInstance | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [cvv, setCvv] = useState("");
  const [cvvTouched, setCvvTouched] = useState(false);
  const [newCvvTouched, setNewCvvTouched] = useState(false);
  const [numberTouched, setNumberTouched] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [form, setForm] = useState({
    number: "",
    name: "",
    expiry: "",
    cvv: "",
    doc: "",
    save: true,
  });


  const configQ = useQuery({
    queryKey: ["mp-card-config", appointmentId],
    queryFn: () =>
      callCardsApi<{ public_key: string | null; amount: number; service_name: string }>({
        action: "config",
        appointment_id: appointmentId,
      }),
  });

  const cardsQ = useQuery({
    queryKey: ["mp-saved-cards", appointmentId],
    queryFn: () =>
      callCardsApi<{ cards: SavedCard[] }>({ action: "list", appointment_id: appointmentId }),
  });

  const publicKey = configQ.data?.public_key ?? null;

  useEffect(() => {
    if (!publicKey) return;
    let active = true;
    loadMpSdk()
      .then(() => {
        if (!active || !window.MercadoPago) return;
        setMp(new window.MercadoPago(publicKey, { locale: "pt-BR" }));
      })
      .catch(() => setMp(null));
    return () => {
      active = false;
    };
  }, [publicKey]);

  const cards = cardsQ.data?.cards ?? [];
  const hasDefault = cards.some((c) => c.is_default);

  // Com cartão padrão: já vem selecionado. Sem padrão: o cliente escolhe manualmente.
  useEffect(() => {
    if (cards.length === 0) {
      setSelectedCardId(null);
      return;
    }
    setSelectedCardId((current) => {
      if (current && cards.some((c) => c.id === current)) return current;
      const preferred = cards.find((c) => c.is_default);
      return preferred ? preferred.id : null;
    });
  }, [cards]);

  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
  const savedCvvError = cvvTouched ? validateCvv(cvv, selectedCard?.brand ?? null, null) : null;
  const newCardCvvError = newCvvTouched ? validateCvv(form.cvv, null, form.number) : null;
  const numberError = numberTouched ? validateCardNumber(form.number) : null;
  const expiryError = expiryTouched ? validateExpiry(form.expiry) : null;
  const newCardInvalid = Boolean(
    validateCardNumber(form.number) ||
      validateExpiry(form.expiry) ||
      validateCvv(form.cvv, null, form.number),
  );

  // Limpa o CVV e o estado de erro ao trocar de cartão.
  useEffect(() => {
    setCvvTouched(false);
  }, [selectedCardId]);


  const payWithSaved = useMutation({
    mutationFn: async (card: SavedCard) => {
      if (!mp) throw new Error("Pagamento com cartão indisponível no momento.");
      const invalid = validateCvv(cvv, card.brand, null);
      if (invalid) throw new Error(invalid);
      const securityCode = digits(cvv);

      const token = await mp.createCardToken({ cardId: card.id, securityCode });
      if (!token.id) throw new Error("Não foi possível validar o cartão salvo.");
      return callCardsApi<{ payment_status: string }>({
        action: "pay",
        appointment_id: appointmentId,
        card_token: token.id,
        saved_card_id: card.id,
      });
    },
    onSuccess: (data) => {
      setCvv("");
      if (data.payment_status === "pago") toast.success("Pagamento aprovado!");
      else toast.info("Pagamento em análise pelo emissor.");
      onPaid(data.payment_status);
    },
    onError: (e: Error) => toast.error("Não foi possível pagar", { description: e.message }),
  });

  const payWithNew = useMutation({
    mutationFn: async () => {
      if (!mp) throw new Error("Pagamento com cartão indisponível no momento.");
      const invalidCvv = validateCvv(form.cvv, null, form.number);
      if (invalidCvv) throw new Error(invalidCvv);
      const [month, year] = form.expiry.split("/");
      if (!month || !year) throw new Error("Informe a validade no formato MM/AA.");

      const token = await mp.createCardToken({
        cardNumber: digits(form.number),
        cardholderName: form.name.trim(),
        cardExpirationMonth: digits(month),
        cardExpirationYear: digits(year).length === 2 ? `20${digits(year)}` : digits(year),
        securityCode: digits(form.cvv),
        identificationType: "CPF",
        identificationNumber: digits(form.doc),
      });
      if (!token.id) throw new Error("Dados do cartão inválidos.");
      return callCardsApi<{ payment_status: string }>({
        action: "pay",
        appointment_id: appointmentId,
        card_token: token.id,
        save_card: form.save,
      });
    },
    onSuccess: (data) => {
      setNewCardOpen(false);
      setForm({ number: "", name: "", expiry: "", cvv: "", doc: "", save: true });
      queryClient.invalidateQueries({ queryKey: ["mp-saved-cards", appointmentId] });
      if (data.payment_status === "pago") toast.success("Pagamento aprovado!");
      else toast.info("Pagamento em análise pelo emissor.");
      onPaid(data.payment_status);
    },
    onError: (e: Error) => toast.error("Não foi possível pagar", { description: e.message }),
  });

  const removeCard = useMutation({
    mutationFn: (cardId: string) =>
      callCardsApi<{ ok: boolean }>({ action: "delete", saved_card_id: cardId }),
    onSuccess: () => {
      toast.success("Cartão removido");
      queryClient.invalidateQueries({ queryKey: ["mp-saved-cards", appointmentId] });
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  const unavailable = useMemo(
    () => !configQ.isLoading && !publicKey,
    [configQ.isLoading, publicKey],
  );

  if (unavailable) return null;

  return (
    <section className="surface mt-5 space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Zap className="size-4" /> Pagar em 1 clique
      </h2>

      {(configQ.isLoading || cardsQ.isLoading) && (
        <div className="flex justify-center py-3">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {!cardsQ.isLoading && cards.length > 0 && !hasDefault && (
        <p className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Você ainda não definiu um cartão padrão. Escolha abaixo qual cartão usar agora ou adicione
          um novo antes de pagar.
        </p>
      )}

      {cards.map((card) => {
        const selected = selectedCardId === card.id;
        return (
          <div
            key={card.id}
            className={cn(
              "rounded-xl border p-3 transition-colors",
              selected ? "border-[var(--brand-from)] bg-secondary/40" : "border-border/60",
            )}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedCardId(card.id);
                setCvv("");
              }}
              className="flex w-full items-center gap-3 text-left"
            >
              {selected ? (
                <CheckCircle2 className="size-4 text-[var(--brand-from)]" />
              ) : (
                <CreditCard className="size-4 text-muted-foreground" />
              )}
              <div className="flex-1 text-sm">
                <p className="font-medium">
                  {card.brand ?? "Cartão"} •••• {card.last_four ?? "0000"}
                  {card.is_default && (
                    <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                      Padrão
                    </span>
                  )}
                </p>
                {card.expiration_month && card.expiration_year && (
                  <p className="text-xs text-muted-foreground">
                    Validade {String(card.expiration_month).padStart(2, "0")}/
                    {String(card.expiration_year).slice(-2)}
                  </p>
                )}
              </div>
            </button>

            {selected && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={cvvLengthFor(card.brand, null)}
                    placeholder={cvvLengthFor(card.brand, null) === 4 ? "CVV (4)" : "CVV"}
                    value={cvv}
                    aria-invalid={Boolean(savedCvvError)}
                    aria-describedby={savedCvvError ? "saved-cvv-error" : undefined}
                    onBlur={() => setCvvTouched(true)}
                    onChange={(e) =>
                      setCvv(digits(e.target.value).slice(0, cvvLengthFor(card.brand, null)))
                    }
                    className="w-24"
                  />
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setCvvTouched(true);
                      if (validateCvv(cvv, card.brand, null)) return;
                      payWithSaved.mutate(card);
                    }}
                    disabled={payWithSaved.isPending || Boolean(validateCvv(cvv, card.brand, null))}
                  >
                    {payWithSaved.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
                    Pagar agora
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover cartão"
                    onClick={() => removeCard.mutate(card.id)}
                    disabled={removeCard.isPending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {savedCvvError ? (
                  <p id="saved-cvv-error" className="text-[11px] text-destructive">
                    {savedCvvError}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {cvvLengthFor(card.brand, null) === 4
                      ? "Amex: 4 dígitos na frente do cartão."
                      : "3 dígitos no verso do cartão."}
                  </p>
                )}
              </div>
            )}

          </div>
        );
      })}

      {cards.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Toque em outro cartão para trocar antes de pagar.
        </p>
      )}


      {!cardsQ.isLoading && cards.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Você ainda não tem cartões salvos. Pague uma vez com cartão e salve para as próximas.
        </p>
      )}

      {newCardOpen ? (
        <div className="space-y-2 rounded-xl border border-border/60 p-3">
          <Input
            inputMode="numeric"
            placeholder="Número do cartão"
            value={form.number}
            onChange={(e) => setForm((f) => ({ ...f, number: digits(e.target.value).slice(0, 19) }))}
          />
          <Input
            placeholder="Nome impresso no cartão"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="MM/AA"
              value={form.expiry}
              onChange={(e) => {
                const d = digits(e.target.value).slice(0, 4);
                setForm((f) => ({
                  ...f,
                  expiry: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d,
                }));
              }}
            />
            <div>
              <Input
                inputMode="numeric"
                placeholder="CVV"
                maxLength={cvvLengthFor(null, form.number)}
                value={form.cvv}
                aria-invalid={Boolean(newCardCvvError)}
                aria-describedby={newCardCvvError ? "new-card-cvv-error" : undefined}
                onBlur={() => setNewCvvTouched(true)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    cvv: digits(e.target.value).slice(0, cvvLengthFor(null, f.number)),
                  }))
                }
              />
              {newCardCvvError && (
                <p id="new-card-cvv-error" className="mt-1 text-[11px] text-destructive">
                  {newCardCvvError}
                </p>
              )}
            </div>

          </div>
          <Input
            inputMode="numeric"
            placeholder="CPF do titular"
            value={form.doc}
            onChange={(e) => setForm((f) => ({ ...f, doc: digits(e.target.value).slice(0, 11) }))}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.save}
              onChange={(e) => setForm((f) => ({ ...f, save: e.target.checked }))}
            />
            Salvar este cartão para pagar em 1 clique depois
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() => {
                setNumberTouched(true);
                setExpiryTouched(true);
                setNewCvvTouched(true);
                if (newCardInvalid) return;
                payWithNew.mutate();
              }}
              disabled={payWithNew.isPending || newCardInvalid}
            >
              {payWithNew.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />}
              Pagar
            </Button>
            <Button variant="ghost" onClick={() => setNewCardOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setNewCardOpen(true)}>
          <CreditCard /> Usar outro cartão
        </Button>
      )}
    </section>
  );
}

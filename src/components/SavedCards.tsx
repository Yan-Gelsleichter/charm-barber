import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Trash2,
  Zap,
} from "lucide-react";

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

async function callCardsApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sua sessão expirou. Faça login novamente.");
  const response = await fetch("/api/public/mercadopago-cards", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    detail?: string | null;
  } & T;
  if (!response.ok) {
    const base = data.error ?? "Falha ao processar o cartão.";
    throw new Error(data.detail ? `${base} (${data.detail})` : base);
  }
  return data;
}

/**
 * Tokeniza o cartão direto no navegador pela API pública do Mercado Pago
 * (/v1/card_tokens). Nenhum dado sensível (número/CVV) chega ao nosso servidor:
 * só o token de uso único é enviado adiante.
 */
async function createCardToken(
  publicKey: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    cause?: Array<{ description?: string; code?: string | number }>;
  };
  if (!response.ok || !data.id) {
    const cause = data.cause?.[0]?.description;
    throw new Error(cause || data.message || "Não foi possível validar os dados do cartão.");
  }
  return data.id;
}


function digits(value: string) {
  return value.replace(/\D/g, "");
}

export type CardBrand = {
  key: string;
  label: string;
  /** Comprimentos válidos do número. */
  lengths: number[];
  /** Tamanho do código de segurança. */
  cvv: number;
  /** Grupos da máscara. */
  groups: number[];
};

const BRANDS: Array<CardBrand & { test: (d: string) => boolean }> = [
  {
    key: "amex",
    label: "Amex",
    lengths: [15],
    cvv: 4,
    groups: [4, 6, 5],
    test: (d) => /^3[47]/.test(d),
  },
  {
    key: "diners",
    label: "Diners",
    lengths: [14, 16],
    cvv: 3,
    groups: [4, 6, 4],
    test: (d) => /^3(?:0[0-5]|[68])/.test(d),
  },
  {
    key: "elo",
    label: "Elo",
    lengths: [16],
    cvv: 3,
    groups: [4, 4, 4, 4],
    test: (d) => /^(4011|4312|4389|4514|4576|5041|5066|5090|6277|6362|6363|650|6516|6550)/.test(d),
  },
  {
    key: "hipercard",
    label: "Hipercard",
    lengths: [16],
    cvv: 3,
    groups: [4, 4, 4, 4],
    test: (d) => /^(606282|3841)/.test(d),
  },
  {
    key: "visa",
    label: "Visa",
    lengths: [13, 16, 19],
    cvv: 3,
    groups: [4, 4, 4, 4, 3],
    test: (d) => /^4/.test(d),
  },
  {
    key: "mastercard",
    label: "Mastercard",
    lengths: [16],
    cvv: 3,
    groups: [4, 4, 4, 4],
    test: (d) => /^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/.test(d),
  },
  {
    key: "discover",
    label: "Discover",
    lengths: [16, 19],
    cvv: 3,
    groups: [4, 4, 4, 4, 3],
    test: (d) => /^(6011|64[4-9]|65)/.test(d),
  },
  {
    key: "jcb",
    label: "JCB",
    lengths: [16, 19],
    cvv: 3,
    groups: [4, 4, 4, 4, 3],
    test: (d) => /^35(2[89]|[3-8])/.test(d),
  },
];

const UNKNOWN_BRAND: CardBrand = {
  key: "unknown",
  label: "",
  lengths: [16, 19],
  cvv: 3,
  groups: [4, 4, 4, 4, 3],
};

/** Detecta a bandeira pelo número digitado (ou pelo nome salvo). */
export function detectCardBrand(cardNumber?: string | null, brandName?: string | null): CardBrand {
  const d = digits(cardNumber ?? "");
  if (d) {
    const match = BRANDS.find((b) => b.test(d));
    if (match) return match;
  }
  const name = (brandName ?? "").toLowerCase();
  if (name) {
    const byName = BRANDS.find(
      (b) => name.includes(b.key) || (b.key === "amex" && name.includes("american")),
    );
    if (byName) return byName;
  }
  return UNKNOWN_BRAND;
}

/** Tamanho máximo do número para a bandeira detectada. */
export function maxCardLength(cardNumber?: string | null) {
  const brand = detectCardBrand(cardNumber);
  return Math.max(...brand.lengths);
}

/** Amex usa 4 dígitos; as demais bandeiras usam 3. */
export function cvvLengthFor(brand?: string | null, cardNumber?: string | null) {
  return detectCardBrand(cardNumber, brand).cvv;
}

/** Formata o número do cartão conforme a bandeira detectada. */
export function formatCardNumber(value: string) {
  const brand = detectCardBrand(value);
  const d = digits(value).slice(0, Math.max(...brand.lengths));
  const parts: string[] = [];
  let i = 0;
  for (const size of brand.groups) {
    if (i >= d.length) break;
    parts.push(d.slice(i, i + size));
    i += size;
  }
  return parts.join(" ");
}

/** Máscara de exibição do cartão salvo conforme a bandeira (•••• 1234). */
export function maskedCardNumber(brandName?: string | null, lastFour?: string | null) {
  const brand = detectCardBrand(null, brandName);
  const last = digits(lastFour ?? "").slice(-4) || "0000";
  const total = brand.lengths.includes(16) ? 16 : (brand.lengths[0] ?? 16);
  const hidden = Math.max(total - last.length, 0);
  const chars = "•".repeat(hidden) + last;
  const parts: string[] = [];
  let i = 0;
  for (const size of brand.groups) {
    if (i >= chars.length) break;
    parts.push(chars.slice(i, i + size));
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
  const brand = detectCardBrand(d);
  const min = Math.min(...brand.lengths);
  const max = Math.max(...brand.lengths);
  if (!brand.lengths.includes(d.length)) {
    if (d.length < min) {
      const label = brand.label ? `${brand.label}: o` : "O";
      return `${label} número deve ter ${brand.lengths.join(" ou ")} dígitos.`;
    }
    if (d.length > max) return "Número do cartão inválido.";
    return `O número do cartão deve ter ${brand.lengths.join(" ou ")} dígitos.`;
  }
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

/** Rascunho do checkout (sem dados sensíveis) para não perder a escolha ao trocar de método. */
function draftKey(appointmentId: string) {
  return `checkout-card-draft:${appointmentId}`;
}

type CheckoutDraft = { selectedCardId: string | null; newCardOpen: boolean; name: string };

function readDraft(appointmentId: string): CheckoutDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(draftKey(appointmentId));
    return raw ? (JSON.parse(raw) as CheckoutDraft) : null;
  } catch {
    return null;
  }
}

export function SavedCards({
  appointmentId,
  onPaid,
  openNewCardSignal = 0,
}: {
  appointmentId: string;
  onPaid: (status: string) => void;
  /** Incrementa para abrir o formulário de cartão nesta página (sem redirecionamento). */
  openNewCardSignal?: number;
}) {
  const queryClient = useQueryClient();
  const sectionRef = useRef<HTMLElement | null>(null);
  const draft = useMemo(() => readDraft(appointmentId), [appointmentId]);
  
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    draft?.selectedCardId ?? null,
  );
  const [cvv, setCvv] = useState("");
  const [cvvTouched, setCvvTouched] = useState(false);
  const [newCvvTouched, setNewCvvTouched] = useState(false);
  const [numberTouched, setNumberTouched] = useState(false);
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [newCardOpen, setNewCardOpen] = useState(draft?.newCardOpen ?? false);
  const [payError, setPayError] = useState<string | null>(null);
  const [form, setForm] = useState({
    number: "",
    name: draft?.name ?? "",
    expiry: "",
    cvv: "",
    doc: "",
    save: true,
  });

  // Mantém a escolha do método mesmo ao alternar telas/recarregar (nunca guarda dados do cartão).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(
        draftKey(appointmentId),
        JSON.stringify({ selectedCardId, newCardOpen, name: form.name }),
      );
    } catch {
      /* ignore */
    }
  }, [appointmentId, selectedCardId, newCardOpen, form.name]);

  // Pedido externo (botão "Pagar com cartão"): abre o formulário aqui mesmo.
  useEffect(() => {
    if (!openNewCardSignal) return;
    setSelectedCardId(null);
    setPayError(null);
    setNewCardOpen(true);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openNewCardSignal]);

  const configQ = useQuery({
    queryKey: ["mp-card-config", appointmentId],
    queryFn: () =>
      callCardsApi<{
        public_key: string | null;
        sandbox?: boolean;
        amount: number;
        service_name: string;
      }>({
        action: "config",
        appointment_id: appointmentId,
      }),
  });

  const cardsQ = useQuery({
    queryKey: ["mp-saved-cards", appointmentId],
    queryFn: () =>
      callCardsApi<{ cards: SavedCard[] }>({ action: "list", appointment_id: appointmentId }),
  });

  // Chave pública do MP exposta ao navegador via variável do Vite.
  const envPublicKey = ((import.meta.env.VITE_MP_PUBLIC_KEY as string | undefined) ?? "").trim();
  const serverPublicKey = (configQ.data?.public_key ?? "").trim();
  const isTestKey = (k: string) => k.toUpperCase().startsWith("TEST-");
  // Em modo de teste, a chave TEST- do build tem prioridade (evita misturar
  // Public Key de produção com Access Token de teste => internal_error).
  const publicKey =
    (configQ.data?.sandbox && isTestKey(envPublicKey)
      ? envPublicKey
      : serverPublicKey || envPublicKey) || null;





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
  const newCardBrand = detectCardBrand(form.number);
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
      if (!publicKey) throw new Error("Pagamento com cartão indisponível no momento.");
      const invalid = validateCvv(cvv, card.brand, null);
      if (invalid) throw new Error(invalid);

      const tokenId = await createCardToken(publicKey, {
        card_id: card.id,
        security_code: digits(cvv),
      });
      return callCardsApi<{ payment_status: string }>({
        action: "pay",
        appointment_id: appointmentId,
        card_token: tokenId,
        saved_card_id: card.id,
      });
    },
    onSuccess: (data) => {
      setCvv("");
      setPayError(null);
      try {
        sessionStorage.removeItem(draftKey(appointmentId));
      } catch {
        /* ignore */
      }

      if (data.payment_status === "pago") toast.success("Pagamento aprovado!");
      else toast.info("Pagamento em análise pelo emissor.");
      onPaid(data.payment_status);
    },
    onError: (e: Error) => {
      setPayError(e.message);
      toast.error("Não foi possível pagar", { description: e.message, duration: 8000 });
    },
  });

  const payWithNew = useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error("Pagamento com cartão indisponível no momento.");
      const invalidNumber = validateCardNumber(form.number);
      if (invalidNumber) throw new Error(invalidNumber);
      const invalidExpiry = validateExpiry(form.expiry);
      if (invalidExpiry) throw new Error(invalidExpiry);
      const invalidCvv = validateCvv(form.cvv, null, form.number);
      if (invalidCvv) throw new Error(invalidCvv);
      const [month, year] = form.expiry.split("/");
      if (!month || !year) throw new Error("Informe a validade no formato MM/AA.");
      const fullYear = digits(year).length === 2 ? `20${digits(year)}` : digits(year);

      const tokenId = await createCardToken(publicKey, {
        card_number: digits(form.number),
        expiration_month: Number(digits(month)),
        expiration_year: Number(fullYear),
        security_code: digits(form.cvv),
        cardholder: {
          name: form.name.trim(),
          ...(digits(form.doc)
            ? { identification: { type: "CPF", number: digits(form.doc) } }
            : {}),
        },
      });
      return callCardsApi<{ payment_status: string }>({
        action: "pay",
        appointment_id: appointmentId,
        card_token: tokenId,
        save_card: form.save,
        expiration_month: Number(digits(month)),
        expiration_year: Number(fullYear),
      });
    },
    onSuccess: (data) => {
      setNewCardOpen(false);
      setPayError(null);
      setForm({ number: "", name: "", expiry: "", cvv: "", doc: "", save: true });
      try {
        sessionStorage.removeItem(draftKey(appointmentId));
      } catch {
        /* ignore */
      }
      queryClient.invalidateQueries({ queryKey: ["mp-saved-cards", appointmentId] });

      if (data.payment_status === "pago") toast.success("Pagamento aprovado!");
      else toast.info("Pagamento em análise pelo emissor.");
      onPaid(data.payment_status);
    },
    onError: (e: Error) => {
      setPayError(e.message);
      toast.error("Não foi possível pagar", { description: e.message, duration: 8000 });
    },
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

  const charging = payWithSaved.isPending || payWithNew.isPending;
  const busy = charging || removeCard.isPending;
  const noSavedCards = !cardsQ.isLoading && cards.length === 0;


  // Sem chave pública do Mercado Pago não dá para tokenizar o cartão.
  // Antes a seção sumia em silêncio (botão "parecia" não fazer nada);
  // agora explicamos o motivo quando o cliente pede para pagar com cartão.
  if (unavailable) {
    if (!openNewCardSignal) return null;
    return (
      <section ref={sectionRef} className="surface mt-5 space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="size-4" /> Pagamento com cartão indisponível
        </h2>
        <p className="text-xs text-muted-foreground">
          {configQ.error instanceof Error
            ? configQ.error.message
            : "Esta barbearia ainda não habilitou o pagamento com cartão. Use o PIX ou pague presencialmente."}
        </p>
      </section>
    );
  }


  return (
    <section ref={sectionRef} className="surface relative mt-5 space-y-3 p-4" aria-busy={busy}>
      {charging && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-background/80 px-6 text-center backdrop-blur-sm"
        >
          <Loader2 className="size-6 animate-spin text-[var(--brand-from)]" />
          <p className="text-sm font-semibold">Processando pagamento…</p>
          <p className="text-xs text-muted-foreground">
            Não feche nem atualize esta tela. Aguarde o resultado da cobrança.
          </p>
        </div>
      )}

      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Zap className="size-4" /> Pagar com cartão nesta página
      </h2>

      {(configQ.isLoading || cardsQ.isLoading) && (
        <div className="flex justify-center py-3">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {payError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Pagamento não concluído</p>
            <p className="mt-0.5 text-destructive/90">{payError}</p>
          </div>
          <button type="button" className="text-[11px] underline" onClick={() => setPayError(null)}>
            Fechar
          </button>
        </div>
      )}

      {!cardsQ.isLoading && !newCardOpen && cards.length > 0 && !hasDefault && (
        <p className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Você ainda não definiu um cartão padrão. Escolha abaixo qual cartão usar agora ou adicione
          um novo antes de pagar.
        </p>
      )}

      {!newCardOpen && cards.map((card) => {
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
              disabled={busy}
              className="flex w-full items-center gap-3 text-left disabled:opacity-60"
            >
              {selected ? (
                <CheckCircle2 className="size-4 text-[var(--brand-from)]" />
              ) : (
                <CreditCard className="size-4 text-muted-foreground" />
              )}
              <div className="flex-1 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {detectCardBrand(null, card.brand).label || card.brand || "Cartão"}
                  </span>
                  <span className="font-mono text-xs tracking-wide">
                    {maskedCardNumber(card.brand, card.last_four)}
                  </span>
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
                    disabled={busy}
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
                    disabled={busy || Boolean(validateCvv(cvv, card.brand, null))}
                  >
                    {payWithSaved.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
                    {payWithSaved.isPending ? "Processando…" : "Pagar agora"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remover cartão"
                    onClick={() => removeCard.mutate(card.id)}
                    disabled={busy}
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

      {!newCardOpen && cards.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Toque em outro cartão para trocar o método antes de pagar — seu agendamento continua
          reservado.
        </p>
      )}

      {(newCardOpen || noSavedCards) ? (

        <div className="space-y-2 rounded-xl border border-border/60 p-3">
          <div>
            <div className="relative">
              <Input
                inputMode="numeric"
                placeholder="Número do cartão"
                value={formatCardNumber(form.number)}
                aria-invalid={Boolean(numberError)}
                aria-describedby={numberError ? "card-number-error" : undefined}
                onBlur={() => setNumberTouched(true)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    number: digits(e.target.value).slice(0, maxCardLength(e.target.value)),
                  }))
                }
                className={newCardBrand.label ? "pr-24" : undefined}
              />
              {newCardBrand.label && (
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {newCardBrand.label}
                </span>
              )}
            </div>
            {numberError && (
              <p id="card-number-error" className="mt-1 text-[11px] text-destructive">
                {numberError}
              </p>
            )}
          </div>
          <Input
            placeholder="Nome impresso no cartão"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input
                inputMode="numeric"
                placeholder="MM/AA"
                value={form.expiry}
                aria-invalid={Boolean(expiryError)}
                aria-describedby={expiryError ? "card-expiry-error" : undefined}
                onBlur={() => setExpiryTouched(true)}
                onChange={(e) => {
                  const d = digits(e.target.value).slice(0, 4);
                  setForm((f) => ({
                    ...f,
                    expiry: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d,
                  }));
                }}
              />
              {expiryError && (
                <p id="card-expiry-error" className="mt-1 text-[11px] text-destructive">
                  {expiryError}
                </p>
              )}
            </div>
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
          <div className={noSavedCards ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
            <Button
              onClick={() => {
                setNumberTouched(true);
                setExpiryTouched(true);
                setNewCvvTouched(true);
                if (newCardInvalid) return;
                payWithNew.mutate();
              }}
              disabled={busy || newCardInvalid}
            >
              {payWithNew.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />}
              {payWithNew.isPending ? "Processando…" : "Pagar"}
            </Button>
            {!noSavedCards && (
              <Button variant="ghost" disabled={busy} onClick={() => setNewCardOpen(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => setNewCardOpen(true)}
        >
          <CreditCard /> Usar outro cartão
        </Button>
      )}

    </section>
  );
}

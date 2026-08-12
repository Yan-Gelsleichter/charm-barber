import { createFileRoute } from "@tanstack/react-router";
import { mpPlatformCredentials, credentialMismatch } from "@/lib/mp-platform.server";
import { mpNotificationUrl } from "@/lib/mp-webhook.server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sanitizeMpDeviceId } from "@/lib/mp-device-id";
import { isValidCPF } from "@/lib/format";
import { PAYER_EMAIL_ERROR, resolvePayerEmail } from "@/lib/mp-payer.server";
import { logPaymentAttempt, logPaymentResult } from "@/lib/mp-audit.server";

/** Valida os 11 dígitos do CPF (dígitos verificadores oficiais). */
const isValidCPFDigits = (v: string) => isValidCPF(v);


const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("config"), appointment_id: z.string().uuid() }),
  z.object({ action: z.literal("list"), appointment_id: z.string().uuid() }),
  z.object({
    action: z.literal("save"),
    appointment_id: z.string().uuid(),
    card_token: z.string().min(10).max(120),
    make_default: z.boolean().optional(),
    card_number: z.string().min(12).max(25).optional(),
    expiration_month: z.coerce.number().int().min(1).max(12).optional(),
    expiration_year: z.coerce.number().int().min(2000).max(2100).optional(),
  }),
  z.object({
    action: z.literal("pay"),
    appointment_id: z.string().uuid(),
    card_token: z.string().min(10).max(120),
    /** Bandeira detectada no navegador; o servidor revalida pelo token. */
    payment_method_id: z
      .string()
      .min(2)
      .max(30)
      .transform((v) => v.trim().toLowerCase())
      .optional(),
    saved_card_id: z.string().uuid().optional(),
    installments: z.coerce.number().int().min(1).max(12).optional(),
    save_card: z.boolean().optional(),
    /** Segundo token (uso único) gerado só para vincular o cartão ao customer. */
    save_card_token: z.string().min(10).max(120).optional(),
    save_card_as_default: z.boolean().optional(),
    card_number: z.string().min(12).max(25).optional(),
    /** E-mail do pagador vindo do cadastro (o servidor revalida). */
    payer_email: z.string().max(160).optional(),
    /** CPF do titular (somente dígitos ou formatado). */
    payer_doc: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => /^\d{11}$/.test(v), "CPF deve conter 11 dígitos.")
      .refine(isValidCPFDigits, "CPF inválido.")
      .optional(),
    cardholder_name: z.string().min(2).max(80).optional(),
    expiration_month: z.coerce.number().int().min(1).max(12).optional(),
    expiration_year: z.coerce.number().int().min(2000).max(2100).optional(),
    /** Device fingerprint (security.js) exigido pelo antifraude do Mercado Pago. */
    device_id: z
      .unknown()
      .optional()
      .transform((v) => sanitizeMpDeviceId(v) ?? undefined),
  }),



  z.object({ action: z.literal("delete"), saved_card_id: z.string().uuid() }),
  z.object({ action: z.literal("my_cards") }),
  z.object({ action: z.literal("set_default"), saved_card_id: z.string().uuid() }),
  z.object({
    action: z.literal("update"),
    saved_card_id: z.string().uuid(),
    cardholder_name: z.string().min(2).max(80).optional(),
    expiration_month: z.number().int().min(1).max(12).optional(),
    expiration_year: z.number().int().min(2024).max(2100).optional(),
  }),
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function safePaymentPayload(payload: Record<string, unknown>) {
  const payer = payload["payer"] as Record<string, unknown> | undefined;
  const identification = payer?.["identification"] as Record<string, unknown> | undefined;
  return {
    ...payload,
    token: payload["token"] ? "[REDACTED_CARD_TOKEN]" : undefined,
    payer: payer
      ? {
          ...payer,
          email: payer["email"] ? "[REDACTED_EMAIL]" : undefined,
          identification: identification
            ? { ...identification, number: "[REDACTED_DOCUMENT]" }
            : undefined,
        }
      : undefined,
  };
}

async function readMpResponse(response: Response): Promise<{ raw: string; payload: unknown }> {
  const raw = await response.text().catch((error) => {
    console.error("Mercado Pago: falha ao ler o corpo da resposta", {
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    });
    return "";
  });
  if (!raw) return { raw, payload: {} };
  try {
    return { raw, payload: JSON.parse(raw) as unknown };
  } catch {
    return { raw, payload: { non_json_body: raw } };
  }
}

function logMpFailure(
  operation: string,
  response: Response,
  responseBody: { raw: string; payload: unknown },
  requestPayload?: Record<string, unknown>,
) {
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("x-correlation-id") ??
    response.headers.get("x-meli-session-id");
  const entry = {
    event: "mp_card_api_error",
    operation,
    at: new Date().toISOString(),
    http_status: response.status,
    http_status_text: response.statusText,
    request_id: requestId,
    response_headers: Object.fromEntries(response.headers.entries()),
    response_json: responseBody.payload,
    response_raw: responseBody.raw,
    ...(requestPayload ? { request_payload: safePaymentPayload(requestPayload) } : {}),
  };

  // O marcador fixo facilita localizar a tentativa nos logs do servidor. A
  // versão serializada preserva integralmente arrays de `cause` e objetos
  // aninhados que alguns visualizadores de console recolhem/achatam.
  console.error("[mp-card-api-error]", entry);
  console.log("[mp-card-api-error-json]", JSON.stringify(entry));
}

const BRAND_BINS: Array<[string, RegExp]> = [
  ["Amex", /^3[47]/],
  ["Diners", /^3(?:0[0-5]|[68])/],
  ["Elo", /^(4011|4312|4389|4514|4576|5041|5066|5090|6277|6362|6363|650|6516|6550)/],
  ["Hipercard", /^(606282|3841)/],
  ["Visa", /^4/],
  ["Mastercard", /^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/],
  ["Discover", /^(6011|64[4-9]|65)/],
  ["JCB", /^35(2[89]|[3-8])/],
];

const BRAND_ALIASES: Array<[string, RegExp]> = [
  ["Amex", /amex|american/i],
  ["Diners", /diners/i],
  ["Elo", /elo/i],
  ["Hipercard", /hiper/i],
  ["Visa", /visa/i],
  ["Mastercard", /master|mc$/i],
  ["Discover", /discover/i],
  ["JCB", /jcb/i],
];

/** Normaliza a bandeira: usa o nome vindo do Mercado Pago e cai para o BIN. */
function normalizeBrand(name?: string | null, cardNumber?: string | null): string | null {
  const raw = (name ?? "").trim();
  if (raw) {
    const alias = BRAND_ALIASES.find(([, re]) => re.test(raw));
    if (alias) return alias[0];
  }
  const pan = (cardNumber ?? "").replace(/\D/g, "");
  if (pan) {
    const bin = BRAND_BINS.find(([, re]) => re.test(pan));
    if (bin) return bin[0];
  }
  return raw || null;
}

/** IDs de meio de pagamento do Mercado Pago por bandeira. */
const MP_METHOD_IDS: Record<string, string> = {
  Visa: "visa",
  Mastercard: "master",
  Amex: "amex",
  Elo: "elo",
  Hipercard: "hipercard",
  Diners: "diners",
  Discover: "discover",
  JCB: "jcb",
};

/**
 * Deduz o payment_method_id ("visa", "master"...) a partir do que o
 * Mercado Pago devolveu no token ou dos primeiros dígitos digitados.
 * Sem isso a API responde "Cannot infer Payment Method".
 */
function inferPaymentMethodId(
  fromMp?: string | null,
  brand?: string | null,
  cardNumber?: string | null,
): string | null {
  const direct = (fromMp ?? "").trim().toLowerCase();
  if (direct) return direct;
  const normalized = normalizeBrand(brand, cardNumber);
  if (normalized && MP_METHOD_IDS[normalized]) return MP_METHOD_IDS[normalized];
  return null;
}

/** Algoritmo de Luhn — nunca registramos o número, apenas validamos. */
function luhnValid(raw: string): boolean {
  const pan = raw.replace(/\D/g, "");
  if (pan.length < 12 || pan.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i -= 1) {
    let digit = Number(pan[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Validade precisa existir e não pode estar vencida (fim do mês informado). */
function expiryValid(month?: number | null, year?: number | null): boolean {
  if (!month || !year) return false;
  if (month < 1 || month > 12) return false;
  const full = year < 100 ? 2000 + year : year;
  const now = new Date();
  const endOfMonth = new Date(Date.UTC(full, month, 1));
  return endOfMonth.getTime() > now.getTime();
}

/** Confere no Mercado Pago os dados reais do token (validade e status). */
async function inspectCardToken(accessToken: string, cardToken: string) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/card_tokens/${encodeURIComponent(cardToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const responseBody = await readMpResponse(response);
  if (!response.ok) {
    logMpFailure("consulta do token do cartão", response, responseBody, {
      card_token: "[REDACTED_CARD_TOKEN]",
    });
    return null;
  }
  return responseBody.payload as {
    status?: string;
    expiration_month?: number;
    expiration_year?: number;
    last_four_digits?: string;
    first_six_digits?: string;
    payment_method_id?: string;
    payment_method?: { id?: string; name?: string };
    issuer_id?: string | number;
    issuer?: { id?: string | number };
    cardholder?: {
      name?: string;
      identification?: { type?: string; number?: string };
    };
  } | null;
}


/** Validação de servidor: Luhn + validade, mesmo se o front falhar. */
async function assertCardValid(
  accessToken: string,
  input: { card_token: string; card_number?: string; expiration_month?: number; expiration_year?: number },
): Promise<string | null> {
  if (input.card_number && !luhnValid(input.card_number)) {
    return "Número de cartão inválido.";
  }
  if (
    (input.expiration_month || input.expiration_year) &&
    !expiryValid(input.expiration_month, input.expiration_year)
  ) {
    return "Cartão com validade vencida ou inválida.";
  }
  const token = await inspectCardToken(accessToken, input.card_token);
  if (token) {
    if (token.status && !["active", "pending"].includes(token.status.toLowerCase())) {
      return "Cartão não autorizado. Tente novamente.";
    }
    if (!expiryValid(token.expiration_month, token.expiration_year)) {
      return "Cartão com validade vencida ou inválida.";
    }
  }
  return null;
}


/**
 * Traduz o motivo da recusa do Mercado Pago em uma mensagem clara,
 * com instrução do que o cliente deve fazer para tentar de novo.
 */
export function paymentErrorMessage(
  statusDetail?: unknown,
  status?: unknown,
  fallback?: unknown,
): string {
  const detail = String(statusDetail ?? "").toLowerCase();
  const map: Record<string, string> = {
    cc_rejected_bad_filled_card_number:
      "Número do cartão incorreto. Confira os dígitos e tente novamente.",
    cc_rejected_bad_filled_date:
      "Data de validade incorreta. Corrija a validade (MM/AA) e tente novamente.",
    cc_rejected_bad_filled_security_code:
      "Código de segurança (CVV) inválido. Digite o CVV correto e tente novamente.",
    cc_rejected_bad_filled_other:
      "Alguns dados do cartão estão incorretos. Revise número, validade e CVV e tente novamente.",
    cc_rejected_call_for_authorize:
      "O emissor pediu autorização para este valor. Ligue para o banco do cartão, autorize a compra e tente novamente.",
    cc_rejected_card_disabled:
      "Cartão desabilitado. Peça a liberação ao banco emissor ou use outro cartão.",
    cc_rejected_card_error:
      "Não foi possível processar este cartão. Tente novamente em alguns instantes ou use outro cartão.",
    cc_rejected_duplicated_payment:
      "Já existe um pagamento igual em processamento. Aguarde alguns minutos antes de tentar novamente.",
    cc_rejected_high_risk:
      "Pagamento recusado por segurança. Tente outro cartão ou pague com Pix.",
    cc_rejected_insufficient_amount:
      "Saldo ou limite insuficiente. Use outro cartão ou pague com Pix.",
    cc_rejected_invalid_installments:
      "O número de parcelas não é aceito por este cartão. Escolha outra opção e tente novamente.",
    cc_rejected_max_attempts:
      "Você atingiu o limite de tentativas com este cartão. Aguarde alguns minutos ou use outro cartão.",
    cc_rejected_blacklist: "Cartão não autorizado. Use outro cartão ou pague com Pix.",
    cc_rejected_card_type_not_allowed:
      "Este tipo de cartão não é aceito. Use outro cartão ou pague com Pix.",
    cc_rejected_other_reason:
      "O emissor recusou a transação. Tente novamente, use outro cartão ou pague com Pix.",
    cc_amount_rate_limit_exceeded:
      "O valor excede o limite permitido para este cartão. Use outro cartão ou pague com Pix.",
    rejected_insufficient_data:
      "Faltam dados do titular do cartão. Preencha nome e CPF e tente novamente.",
    expired: "O prazo deste pagamento expirou. Gere um novo pagamento e tente novamente.",
  };
  if (detail && map[detail]) return map[detail]!;

  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "expired") {
    return "O prazo deste pagamento expirou. Gere um novo pagamento e tente novamente.";
  }
  if (normalized === "cancelled") {
    return "A transação foi cancelada e não foi concluída. Tente novamente ou use outro meio de pagamento.";
  }
  if (detail.startsWith("cc_rejected")) {
    return "Pagamento recusado pelo emissor do cartão. Tente novamente, use outro cartão ou pague com Pix.";
  }
  const fallbackText = typeof fallback === "string" ? fallback.trim() : "";
  if (fallbackText) {
    return `${fallbackText} Tente novamente, use outro cartão ou pague com Pix.`;
  }
  return "Não foi possível concluir a transação. Tente novamente, use outro cartão ou pague com Pix.";
}


function mapPaymentStatus(mpStatus?: string | null): string {
  switch ((mpStatus ?? "").toLowerCase()) {
    case "approved":
    case "authorized":
      return "pago";
    case "cancelled":
      return "cancelado";
    case "expired":
      return "expirado";
    case "rejected":
      return "falhou";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return "pendente";
  }
}

type Collector = {
  accessToken: string;
  publicKey: string | null;
  collectorId: string;
  shopFee: number;
};

/**
 * Public key da conta conectada via OAuth.
 * Se a barbearia/barbeiro não preencheu a chave manualmente, obtemos a chave
 * direto do Mercado Pago usando as credenciais da conexão OAuth (refresh_token)
 * e guardamos para as próximas cobranças.
 */
async function resolvePublicKey(
  admin: { from: (t: string) => unknown },
  table: "barbershops" | "barbers",
  rowId: string,
  current: string | null,
  refreshToken: string | null,
): Promise<string | null> {
  if (current) return current;
  const clientId = process.env["MP_CLIENT_ID"];
  const clientSecret = process.env["MP_CLIENT_SECRET"];
  if (!refreshToken || !clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    const token = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      public_key?: string;
    };
    if (!res.ok || !token.public_key) return null;

    const payload: Record<string, unknown> = { mp_public_key: token.public_key };
    if (token.access_token) payload["mp_access_token"] = token.access_token;
    if (token.refresh_token) payload["mp_refresh_token"] = token.refresh_token;
    await (admin.from(table) as unknown as {
      update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
    })
      .update(payload)
      .eq("id", rowId);
    return token.public_key;
  } catch {
    return null;
  }
}

/** Texto cru devolvido pelo Mercado Pago (mensagem + causas), para exibir ao cliente. */
function mpDetail(payload: unknown, httpStatus?: number): string | null {
  const body = (payload ?? {}) as {
    message?: unknown;
    error?: unknown;
    status_detail?: unknown;
    cause?: Array<{ description?: unknown; code?: unknown; message?: unknown }>;
  };
  const parts: string[] = [];
  const push = (v: unknown) => {
    const text = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    if (text && !parts.includes(text)) parts.push(text);
  };
  push(body.message);
  push(body.error);
  push(body.status_detail);
  for (const cause of body.cause ?? []) {
    const text = [cause?.code, cause?.description ?? cause?.message].filter(Boolean).join(": ");
    push(text);
  }
  if (parts.length === 0 && httpStatus) parts.push(`HTTP ${httpStatus}`);
  return parts.length ? `Mercado Pago: ${parts.join(" | ")}` : null;
}

/** Credenciais de teste (TEST-...) não cobram cartões reais. */
function isSandboxToken(accessToken: string) {
  return accessToken.trim().toUpperCase().startsWith("TEST-");
}

export const Route = createFileRoute("/api/public/mercadopago-cards")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente para continuar." }, 401);
          }
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) {
            // Mostra qual campo falhou (sem expor valores sensíveis).
            const issue = parsed.error.issues[0];
            const field = issue?.path.join(".") || "campo";
            console.error("[mp-card-request-validation-error]", {
              event: "mp_card_request_validation_error",
              at: new Date().toISOString(),
              issues: parsed.error.issues.map((item) => ({
                field: item.path.join(".") || "campo",
                code: item.code,
                message: item.message,
              })),
            });
            return json(
              { error: "Dados inválidos.", detail: `${field}: ${issue?.message ?? "inválido"}` },
              400,
            );
          }


          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"] ||
            (import.meta.env.VITE_SUPABASE_URL as string | undefined);
          const publishableKey =
            process.env["SUPABASE_PUBLISHABLE_KEY"] ||
            process.env["SB_PUBLISHABLE_KEY"] ||
            process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
            (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
          const serviceKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];
          if (!supabaseUrl || !publishableKey || !serviceKey) {
            console.error("Mercado Pago cartões: credenciais do banco ausentes no servidor", {
              supabaseUrl: !!supabaseUrl,
              publishableKey: !!publishableKey,
              serviceKey: !!serviceKey,
            });
            return json({ error: "O pagamento está temporariamente indisponível." }, 503);
          }

          const asUser = createClient(supabaseUrl, publishableKey, {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userError } = await asUser.auth.getUser();
          if (userError || !userData.user) {
            return json({ error: "Sua sessão expirou. Faça login novamente." }, 401);
          }
          const user = userData.user;
          const userEmail = user.email?.trim().toLowerCase() ?? "";

          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // ---- excluir cartão salvo ----
          if (parsed.data.action === "delete") {
            const { data: card } = await admin
              .from("saved_cards")
              .select("id, user_id, mp_customer_id, mp_card_id, mp_collector_id, barbershop_id")
              .eq("id", parsed.data.saved_card_id)
              .maybeSingle();
            if (!card || (card as { user_id: string }).user_id !== user.id) {
              return json({ error: "Cartão não encontrado." }, 404);
            }
            const row = card as {
              mp_customer_id: string;
              mp_card_id: string;
              barbershop_id: string | null;
              mp_collector_id: string;
            };
            // Remove também no Mercado Pago (best-effort).
            const token = await tokenForCollector(admin, row.mp_collector_id, row.barbershop_id);
            if (token) {
              await fetch(
                `https://api.mercadopago.com/v1/customers/${encodeURIComponent(row.mp_customer_id)}/cards/${encodeURIComponent(row.mp_card_id)}`,
                { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
              ).catch(() => null);
            }
            await admin.from("saved_cards").delete().eq("id", parsed.data.saved_card_id);
            return json({ ok: true });
          }

          // ---- todos os cartões salvos do cliente (tela do painel) ----
          if (parsed.data.action === "my_cards") {
            const { data, error } = await admin
              .from("saved_cards")
              .select(
                "id, mp_card_id, last_four, brand, cardholder_name, expiration_month, expiration_year, is_default, created_at",
              )
              .eq("user_id", user.id)
              .order("created_at", { ascending: false });
            if (error) return json({ cards: [] });
            return json({ cards: data ?? [] });
          }

          // ---- definir cartão padrão ----
          if (parsed.data.action === "set_default") {
            const { data: card } = await admin
              .from("saved_cards")
              .select("id, user_id, mp_customer_id, mp_card_id, mp_collector_id, barbershop_id")
              .eq("id", parsed.data.saved_card_id)
              .maybeSingle();
            const row = card as {
              user_id: string;
              mp_customer_id: string;
              mp_card_id: string;
              mp_collector_id: string;
              barbershop_id: string | null;
            } | null;
            if (!row || row.user_id !== user.id) {
              return json({ error: "Cartão não encontrado." }, 404);
            }
            const { error: clearError } = await admin
              .from("saved_cards")
              .update({ is_default: false })
              .eq("user_id", user.id);
            if (clearError) {
              return json({ error: "Rode o SQL de cartão padrão no Supabase." }, 400);
            }
            await admin
              .from("saved_cards")
              .update({ is_default: true })
              .eq("id", parsed.data.saved_card_id);

            const token = await tokenForCollector(admin, row.mp_collector_id, row.barbershop_id);
            if (token) {
              await fetch(
                `https://api.mercadopago.com/v1/customers/${encodeURIComponent(row.mp_customer_id)}`,
                {
                  method: "PUT",
                  headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
                  body: JSON.stringify({ default_card: row.mp_card_id }),
                },
              ).catch(() => null);
            }
            return json({ ok: true });
          }

          // ---- atualizar dados do cartão salvo ----
          if (parsed.data.action === "update") {
            const { data: card } = await admin
              .from("saved_cards")
              .select("id, user_id, mp_customer_id, mp_card_id, mp_collector_id, barbershop_id")
              .eq("id", parsed.data.saved_card_id)
              .maybeSingle();
            const row = card as {
              user_id: string;
              mp_customer_id: string;
              mp_card_id: string;
              mp_collector_id: string;
              barbershop_id: string | null;
            } | null;
            if (!row || row.user_id !== user.id) {
              return json({ error: "Cartão não encontrado." }, 404);
            }
            const patch: Record<string, unknown> = {};
            if (parsed.data.cardholder_name) patch["cardholder_name"] = parsed.data.cardholder_name;
            if (parsed.data.expiration_month) patch["expiration_month"] = parsed.data.expiration_month;
            if (parsed.data.expiration_year) patch["expiration_year"] = parsed.data.expiration_year;
            if (Object.keys(patch).length === 0) return json({ error: "Nada para atualizar." }, 400);

            const token = await tokenForCollector(admin, row.mp_collector_id, row.barbershop_id);
            if (token) {
              await fetch(
                `https://api.mercadopago.com/v1/customers/${encodeURIComponent(row.mp_customer_id)}/cards/${encodeURIComponent(row.mp_card_id)}`,
                {
                  method: "PUT",
                  headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
                  body: JSON.stringify({
                    ...(parsed.data.expiration_month
                      ? { expiration_month: parsed.data.expiration_month }
                      : {}),
                    ...(parsed.data.expiration_year
                      ? { expiration_year: parsed.data.expiration_year }
                      : {}),
                    ...(parsed.data.cardholder_name
                      ? { cardholder: { name: parsed.data.cardholder_name } }
                      : {}),
                  }),
                },
              ).catch(() => null);
            }
            const { error: updateError } = await admin
              .from("saved_cards")
              .update(patch)
              .eq("id", parsed.data.saved_card_id);
            if (updateError) return json({ error: "Não foi possível atualizar o cartão." }, 400);
            return json({ ok: true });
          }



          // ---- agendamento + conta que recebe ----
          const { data: appointmentRow, error: appointmentError } = await admin
            .from("appointments")
            .select(
              "id, service_id, barber_id, barbershop_id, customer_name, email, payment_status",
            )
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          if (appointmentError) {
            return json({ error: "Não foi possível localizar o agendamento." }, 500);
          }
          const appointment = appointmentRow as {
            id: string;
            service_id: string;
            barber_id: string | null;
            barbershop_id: string | null;
            customer_name: string | null;
            email: string | null;
            payment_status?: string | null;
          } | null;
          if (!appointment) return json({ error: "Agendamento não encontrado." }, 404);

          const appointmentEmail = String(appointment.email ?? "").trim().toLowerCase();
          if (!userEmail || !appointmentEmail || userEmail !== appointmentEmail) {
            return json({ error: "Você não tem acesso a este agendamento." }, 403);
          }

          // payer.email é obrigatório em toda cobrança com cartão (inclusive em
          // retentativas e no salvamento do cartão): resolvemos uma única vez.
          const payerEmail = resolvePayerEmail(userEmail, appointmentEmail);
          if (!payerEmail) return json({ error: PAYER_EMAIL_ERROR }, 400);

          if (!appointment.barbershop_id) {
            return json({ error: "O agendamento não está vinculado a uma barbearia." }, 400);
          }

          const { data: service } = await admin
            .from("services")
            .select("name, price")
            .eq("id", appointment.service_id)
            .maybeSingle();
          const amount = Number((service as { price?: number } | null)?.price ?? 0);

          const { data: shop } = await admin
            .from("barbershops")
            .select(
              "id, mp_access_token, mp_public_key, mp_refresh_token, mp_user_id, payout_mode",
            )
            .eq("id", appointment.barbershop_id)
            .maybeSingle();
          const shopRow = shop as {
            id: string;
            mp_access_token?: string | null;
            mp_public_key?: string | null;
            mp_refresh_token?: string | null;
            mp_user_id?: string | null;
            payout_mode?: string | null;
          } | null;

          let collector: Collector | null = null;
          if (shopRow?.payout_mode === "split" && appointment.barber_id) {
            const { data: barber } = await admin
              .from("barbers")
              .select(
                "id, mp_access_token, mp_public_key, mp_refresh_token, mp_user_id, commission_percent",
              )
              .eq("id", appointment.barber_id)
              .maybeSingle();
            const b = barber as {
              id: string;
              mp_access_token?: string | null;
              mp_public_key?: string | null;
              mp_refresh_token?: string | null;
              mp_user_id?: string | null;
              commission_percent?: number | null;
            } | null;
            if (b?.mp_access_token) {
              const raw = Number(b.commission_percent ?? 0);
              const pct = Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
              collector = {
                accessToken: b.mp_access_token,
                publicKey: await resolvePublicKey(
                  admin,
                  "barbers",
                  b.id,
                  b.mp_public_key ?? null,
                  b.mp_refresh_token ?? null,
                ),
                collectorId: b.mp_user_id ?? `barber:${b.id}`,
                shopFee: Number(((amount * (100 - pct)) / 100).toFixed(2)),
              };
            }
          }
          if (!collector && shopRow?.mp_access_token) {
            collector = {
              accessToken: shopRow.mp_access_token,
              publicKey: await resolvePublicKey(
                admin,
                "barbershops",
                shopRow.id,
                shopRow.mp_public_key ?? null,
                shopRow.mp_refresh_token ?? null,
              ),
              collectorId: shopRow.mp_user_id ?? `shop:${shopRow.id}`,
              shopFee: 0,
            };
          }
          // Credenciais fixas da plataforma (MP_ACCESS_TOKEN): usadas apenas
          // como fallback quando a barbearia/barbeiro ainda não conectou o
          // Mercado Pago. Nunca substituem o recebedor conectado, para que o
          // split (application_fee) continue valendo em produção.
          const platform = mpPlatformCredentials();
          if (!collector && platform) {
            collector = {
              accessToken: platform.accessToken,
              publicKey: platform.publicKey,
              collectorId: `platform:${appointment.barbershop_id}`,
              shopFee: 0,
            };
          }
          if (!collector) {
            return json({ error: "Esta barbearia ainda não conectou o Mercado Pago." }, 400);
          }

          if (!collector.publicKey && parsed.data.action === "config") {
            return json(
              {
                error: platform
                  ? "A Public Key da plataforma (MP_PUBLIC_KEY) não está configurada. Ela precisa ser a chave pública do mesmo aplicativo do MP_ACCESS_TOKEN."
                  : "Não foi possível obter a chave pública da conta Mercado Pago conectada. Reconecte a conta no painel (Pagamentos) para renovar a autorização.",
              },
              400,
            );
          }

          // Public Key e Access Token precisam ser do MESMO ambiente:
          // misturar produção com teste devolve internal_error na tokenização.
          if (
            parsed.data.action === "config" ||
            parsed.data.action === "pay" ||
            parsed.data.action === "save"
          ) {
            const mismatch = credentialMismatch(collector.accessToken, collector.publicKey);
            if (mismatch) return json({ error: mismatch }, 400);
          }



          // ---- configuração para tokenizar no navegador ----
          if (parsed.data.action === "config") {
            return json({
              public_key: collector.publicKey,
              amount,
              service_name: (service as { name?: string } | null)?.name ?? "Serviço",
            });
          }

          // ---- listar cartões salvos ----
          if (parsed.data.action === "list") {
            const { data, error } = await admin
              .from("saved_cards")
              .select(
                "id, mp_card_id, last_four, brand, cardholder_name, expiration_month, expiration_year, is_default",
              )
              .eq("user_id", user.id)
              .eq("mp_collector_id", collector.collectorId)
              .order("is_default", { ascending: false })
              .order("created_at", { ascending: false });
            if (error) {
              // Banco ainda sem a coluna is_default: cai para a listagem simples.
              const { data: legacy } = await admin
                .from("saved_cards")
                .select("id, mp_card_id, last_four, brand, cardholder_name, expiration_month, expiration_year")
                .eq("user_id", user.id)
                .eq("mp_collector_id", collector.collectorId)
                .order("created_at", { ascending: false });
              return json({ cards: legacy ?? [] });
            }
            return json({ cards: data ?? [] });
          }

          if (
            !platform &&
            isSandboxToken(collector.accessToken) &&
            (parsed.data.action === "pay" || parsed.data.action === "save")
          ) {
            return json(
              {
                error:
                  "A conta do Mercado Pago está em modo de teste (sandbox). Conecte as credenciais de produção no painel (Pagamentos) para cobrar cartões reais.",
                detail: "Access token de teste (TEST-...)",
              },
              400,
            );
          }

          const customer = await ensureCustomer(collector.accessToken, payerEmail, {
            name: appointment.customer_name,
          });
          if (!customer.id) {
            return json(
              {
                error: "Não foi possível preparar o cadastro do cartão.",
                ...(customer.detail ? { detail: customer.detail } : {}),
              },
              400,
            );
          }
          const customerId = customer.id;

          // ---- validação de servidor (Luhn + validade) antes de salvar/cobrar ----
          const cardError = await assertCardValid(collector.accessToken, {
            card_token: parsed.data.card_token,
            ...(parsed.data.card_number ? { card_number: parsed.data.card_number } : {}),
            ...(parsed.data.expiration_month
              ? { expiration_month: parsed.data.expiration_month }
              : {}),
            ...(parsed.data.expiration_year
              ? { expiration_year: parsed.data.expiration_year }
              : {}),
          });
          if (cardError) return json({ error: cardError }, 400);

          // ---- salvar cartão ----
          if (parsed.data.action === "save") {
            const saved = await saveCard(
              collector,
              admin,
              user.id,
              appointment.barbershop_id,
              customerId,
              parsed.data.card_token,
              parsed.data.card_number,
              parsed.data.make_default ?? false,
            );
            if ("error" in saved) {
              return json(
                { error: saved.error, ...(saved.detail ? { detail: saved.detail } : {}) },
                400,
              );
            }
            return json({ card: saved.card });
          }


          // ---- pagar (1 clique com cartão salvo ou cartão novo) ----
          let savedBrand: string | null = null;
          if (parsed.data.saved_card_id) {
            // O cartão salvo precisa ser do próprio usuário e da mesma conta recebedora.
            const { data: owned } = await admin
              .from("saved_cards")
              .select("id, brand, expiration_month, expiration_year")
              .eq("id", parsed.data.saved_card_id)
              .eq("user_id", user.id)
              .eq("mp_collector_id", collector.collectorId)
              .maybeSingle();
            if (!owned) return json({ error: "Cartão não encontrado." }, 404);
            const stored = owned as {
              brand?: string | null;
              expiration_month?: number;
              expiration_year?: number;
            };
            savedBrand = stored.brand ?? null;
            if (
              (stored.expiration_month || stored.expiration_year) &&
              !expiryValid(stored.expiration_month, stored.expiration_year)
            ) {
              return json({ error: "Cartão salvo vencido. Atualize a validade." }, 400);
            }
          }
          if (!(amount > 0)) return json({ error: "O serviço não possui um preço válido." }, 400);

          if (parsed.data.action === "pay" && appointment.payment_status === "pago") {
            return json({ error: "Este agendamento já está pago.", payment_status: "pago" }, 409);
          }

          // O Mercado Pago exige o meio de pagamento explícito, senão devolve
          // "Cannot infer Payment Method". Usamos o dado do token e, na falta
          // dele, a bandeira deduzida pelos primeiros dígitos do cartão.
          const tokenInfo = await inspectCardToken(
            collector.accessToken,
            parsed.data.card_token,
          );
          const paymentMethodId = inferPaymentMethodId(
            parsed.data.payment_method_id ??
              tokenInfo?.payment_method_id ??
              tokenInfo?.payment_method?.id ??
              null,
            savedBrand,
            parsed.data.card_number ?? tokenInfo?.first_six_digits ?? null,
          );
          if (!paymentMethodId) {
            return json(
              {
                error:
                  "Não foi possível identificar a bandeira do cartão. Confira o número e tente novamente.",
                detail: "payment_method_id não pôde ser inferido",
              },
              400,
            );
          }
          const issuerId = tokenInfo?.issuer_id ?? tokenInfo?.issuer?.id ?? null;

          // No Sandbox do Mercado Pago, vincular o segundo token depois que a
          // cobrança foi concluída pode responder 500 (internal_server_error).
          // O token de salvamento é independente e de uso único, então fazemos
          // o vínculo antes da cobrança e só persistimos/exibimos o cartão
          // localmente se o pagamento terminar aprovado.
          let prelinkedCard: MercadoPagoCard | null = null;
          let prelinkError: string | null = null;
          if (parsed.data.save_card && !parsed.data.saved_card_id && parsed.data.save_card_token) {
            const linked = await linkCardToCustomer(
              collector.accessToken,
              customerId,
              parsed.data.save_card_token,
            );
            if ("error" in linked) prelinkError = linked.error ?? "Não foi possível salvar este cartão.";
            else prelinkedCard = linked.card;
          }

          // Emissoras brasileiras exigem nome e CPF do titular. Sem esses campos
          // (e sem additional_info) a transação é barrada na antifraude do
          // Mercado Pago e nunca chega ao banco emissor.
          const holderName = (
            parsed.data.cardholder_name ??
            tokenInfo?.cardholder?.name ??
            appointment.customer_name ??
            ""
          ).trim();
          const [firstName, ...restName] = holderName.split(/\s+/).filter(Boolean);
          const lastName = restName.join(" ");
          const payerDoc = (
            parsed.data.payer_doc ??
            tokenInfo?.cardholder?.identification?.number ??
            ""
          ).replace(/\D/g, "");
          if (!isValidCPF(payerDoc)) {
            return json(
              {
                error:
                  "CPF do titular inválido ou ausente. Confira o CPF informado e tente novamente.",
              },
              400,
            );
          }

          // payerEmail já foi resolvido e validado acima (obrigatório pelo MP).


          const payer: Record<string, unknown> = {
            type: "customer",
            id: customerId,
            email: payerEmail,
            identification: { type: "CPF", number: payerDoc },
          };

          if (firstName) payer["first_name"] = firstName;
          if (lastName) payer["last_name"] = lastName;


          // Identificação nova a cada tentativa (nunca reaproveita a anterior),
          // sensível ao valor cobrado — exigência do antifraude do Mercado Pago.
          const attemptId = `${Date.now().toString(36)}-${Math.round(amount * 100)}-${crypto.randomUUID().slice(0, 8)}`;
          const attemptReference = `${appointment.id}:${attemptId}`;

          const serviceName = (service as { name?: string } | null)?.name ?? "Serviço";
          const body: Record<string, unknown> = {
            transaction_amount: Number(amount.toFixed(2)),
            token: parsed.data.card_token,
            payment_method_id: paymentMethodId,
            description: `${serviceName} — agendamento`,
            statement_descriptor: "BARBEARIA",
            installments: parsed.data.installments ?? 1,
            capture: true,
            binary_mode: false,
            payer,
            external_reference: attemptReference,
            // Recebe payment.created / payment.updated automaticamente.
            notification_url: mpNotificationUrl(),
            additional_info: {
              items: [
                {
                  id: String(appointment.service_id ?? appointment.id),
                  title: serviceName,
                  description: `${serviceName} — agendamento`,
                  category_id: "services",
                  quantity: 1,
                  unit_price: Number(amount.toFixed(2)),
                },
              ],
              payer: {
                ...(firstName ? { first_name: firstName } : {}),
                ...(lastName ? { last_name: lastName } : {}),
              },
            },
            metadata: {
              appointment_id: appointment.id,
              barber_id: appointment.barber_id ?? null,
            },
          };
          if (issuerId) body["issuer_id"] = String(issuerId);
          if (collector.shopFee > 0) body["application_fee"] = collector.shopFee;

          // O antifraude do Mercado Pago recusa (cc_rejected_high_risk) quando
          // não recebe o identificador do dispositivo do comprador.
          const deviceId = sanitizeMpDeviceId(parsed.data.device_id);

          const doPay = async (payload: Record<string, unknown>, key: string) => {
            try {
              return await fetch("https://api.mercadopago.com/v1/payments", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${collector.accessToken}`,
                  "content-type": "application/json",
                  "X-Idempotency-Key": key,
                  ...(deviceId ? { "X-meli-session-id": deviceId } : {}),
                },
                body: JSON.stringify(payload),
              });
            } catch (error) {

              console.error("Mercado Pago: exceção ao enviar pagamento", {
                request_payload: safePaymentPayload(payload),
                idempotency_key: key,
                exception:
                  error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        cause: error.cause,
                      }
                    : error,
              });
              throw error;
            }
          };

          const key = `card-${appointment.id}-${attemptId}`;
          const auditBase = {
            method: "credit_card" as const,
            appointmentId: appointment.id,
            barberId: appointment.barber_id ?? null,
            payerEmail,
            externalReference: attemptReference,
            idempotencyKey: key,
            amount: Number(amount.toFixed(2)),
            installments: parsed.data.installments ?? 1,
            deviceId,
            savedCard: Boolean(parsed.data.saved_card_id),
          };
          logPaymentAttempt(auditBase);

          let response = await doPay(body, key);
          if (!response.ok && collector.shopFee > 0) {
            const firstFailure = await readMpResponse(response.clone());
            await logMpFailure(
              "criação do pagamento com cartão (tentativa com taxa)",
              response,
              firstFailure,
              body,
            );
            const detail = firstFailure.raw;
            if (detail.includes("application_fee") || detail.includes("marketplace")) {
              delete body["application_fee"];
              response = await doPay(body, `${key}-nofee`);
            }
          }
          const paymentResponseBody = await readMpResponse(response);
          const payment = paymentResponseBody.payload as {
            id?: number | string;
            status?: string;
            status_detail?: string;
            message?: string;
            payment_method_id?: string;
            card?: MercadoPagoCard;
          };
          logPaymentResult({
            ...auditBase,
            httpStatus: response.status,
            paymentId: payment.id ?? null,
            status: payment.status ?? null,
            statusDetail: payment.status_detail ?? null,
            message: payment.message ?? null,
          });
          if (!response.ok || !payment.id) {
            await logMpFailure("criação do pagamento com cartão", response, paymentResponseBody, body);
            return json(
              {
                error: paymentErrorMessage(payment.status_detail, payment.status, payment.message),
                status_detail: payment.status_detail ?? null,
                detail: mpDetail(payment, response.status),
              },
              400,
            );
          }

          const paymentStatus = mapPaymentStatus(payment.status);
          const paidNow = paymentStatus === "pago";
          const { error: updateError } = await admin
            .from("appointments")
            .update({
              payment_status: paymentStatus,
              payment_method: "credit_card",
              mp_payment_id: String(payment.id),
              paid_at: paidNow ? new Date().toISOString() : null,
            })
            .eq("id", appointment.id);
          if (updateError) {
            console.error("Cartão salvo: falha ao gravar status", updateError);
            return json(
              {
                error: "O pagamento foi processado, mas não foi possível atualizar o agendamento.",
                payment_status: paymentStatus,
              },
              500,
            );
          }
          // O status operacional do agendamento é independente dos campos de pagamento:
          // uma restrição antiga nessa coluna não pode desfazer a gravação de "pago".
          if (paidNow) {
            const { error: appointmentStatusError } = await admin
              .from("appointments")
              .update({ status: "confirmado" })
              .eq("id", appointment.id);
            if (appointmentStatusError) {
              console.warn("Cartão: pagamento salvo, mas status do agendamento não foi alterado", appointmentStatusError);
            }
          }



          // Recusado/expirado/cancelado volta como erro claro para o cliente tentar de novo.
          if (["falhou", "expirado", "cancelado"].includes(paymentStatus)) {
            return json(
              {
                error: paymentErrorMessage(payment.status_detail, payment.status, null),
                payment_status: paymentStatus,
                status_detail: payment.status_detail ?? null,
                detail: mpDetail(payment, response.status),
              },
              400,
            );
          }


          // Salva o cartão novo só depois de aprovado, se o cliente pediu.
          let cardSaved = false;
          let cardSaveError: string | null = null;
          if (parsed.data.save_card && !parsed.data.saved_card_id && paymentStatus === "pago") {
            try {
              const cardFromPayment = payment.card?.id
                ? payment.card
                : await paymentCard(collector.accessToken, payment.id);
              const expectedCard = cardFromPayment ?? payment.card ?? tokenInfo ?? null;
              const reconciledCard = prelinkedCard
                ? null
                : await waitForCustomerCard(
                    collector.accessToken,
                    customerId,
                    expectedCard,
                  );
              const cardReadyToPersist =
                prelinkedCard ?? cardFromPayment ?? reconciledCard;
              const saved = cardReadyToPersist?.id
                ? await persistSavedCard(
                    collector,
                    admin,
                    user.id,
                    appointment.barbershop_id,
                    customerId,
                    {
                      ...cardReadyToPersist,
                      payment_method:
                        cardReadyToPersist.payment_method ??
                        (payment.payment_method_id ? { id: payment.payment_method_id } : undefined),
                    },
                    parsed.data.card_number,
                    parsed.data.save_card_as_default ?? false,
                  )
                : {
                    error:
                      prelinkError ??
                      "O Mercado Pago aprovou a cobrança, mas ainda não disponibilizou o cartão para salvamento.",
                  } as const;
              if ("error" in saved) cardSaveError = saved.error ?? "Não foi possível salvar este cartão.";
              else cardSaved = true;
            } catch (saveError) {
              cardSaveError =
                saveError instanceof Error ? saveError.message : "Não foi possível salvar este cartão.";
            }
            if (cardSaveError) {
              console.error("Mercado Pago: cartão não foi salvo após o pagamento", cardSaveError);
            }
          }

          return json({
            payment_id: payment.id,
            status: payment.status,
            status_detail: payment.status_detail,
            payment_status: paymentStatus,
            card_saved: cardSaved,
            card_save_error: cardSaveError,
          });
        } catch (error) {
          console.error("Mercado Pago cartões: erro inesperado", {
            exception:
              error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    cause: error.cause,
                  }
                : error,
          });
          return json(
            {
              error: "Não foi possível processar o cartão agora.",
              detail: error instanceof Error ? error.message : String(error),
            },
            500,
          );
        }
      },
    },
  },
});

/** Busca (ou cria) o customer do cliente na conta Mercado Pago que recebe. */
async function ensureCustomer(
  accessToken: string,
  email: string,
  extra: { name?: string | null },
): Promise<{ id: string | null; detail?: string | null }> {
  const search = await fetch(
    `https://api.mercadopago.com/v1/customers/search?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const searchBody = await readMpResponse(search);
  const found = searchBody.payload as {
    results?: Array<{ id?: string }>;
  };
  if (search.ok && found.results?.[0]?.id) return { id: found.results[0].id as string };
  if (!search.ok) {
    logMpFailure("busca do customer", search, searchBody);
    return { id: null, detail: mpDetail(found, search.status) };
  }

  const created = await fetch("https://api.mercadopago.com/v1/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      email,
      first_name: String(extra.name ?? "Cliente").split(" ")[0],
    }),
  });
  const createdBody = await readMpResponse(created);
  const customer = createdBody.payload as { id?: string };
  if (!created.ok || !customer.id) {
    logMpFailure("criação do customer", created, createdBody, {
      email: "[REDACTED_EMAIL]",
      first_name: String(extra.name ?? "Cliente").split(" ")[0],
    });
    return { id: null, detail: mpDetail(customer, created.status) };
  }
  return { id: customer.id };
}

/** Vincula o token de cartão ao customer e grava no banco. */
type MercadoPagoCard = {
  id?: string;
  last_four_digits?: string;
  first_six_digits?: string;
  payment_method?: { name?: string; id?: string };
  cardholder?: { name?: string };
  expiration_month?: number;
  expiration_year?: number;
  message?: string;
};

/**
 * O endpoint de vínculo pode devolver 500 no Sandbox mesmo quando o cartão já
 * ficou associado ao customer. Reconsulta a carteira e encontra o cartão pelos
 * dados não sensíveis para que o segundo cartão também seja persistido.
 */
async function findCustomerCard(
  accessToken: string,
  customerId: string,
  expected: MercadoPagoCard | null,
  knownCardIds: Set<string> = new Set(),
): Promise<MercadoPagoCard | null> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(customerId)}/cards`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const responseBody = await readMpResponse(response);
  if (!response.ok) {
    logMpFailure("consulta dos cartões do customer", response, responseBody);
    return null;
  }
  const cards = Array.isArray(responseBody.payload)
    ? (responseBody.payload as MercadoPagoCard[])
    : [];
  const candidates = cards.filter((card) => !card.id || !knownCardIds.has(card.id));
  if (candidates.length === 0) return null;

  const expectedLastFour = expected?.last_four_digits;
  const expectedMonth = expected?.expiration_month;
  const expectedYear = expected?.expiration_year;
  const expectedMethod = expected?.payment_method?.id;
  return (
    candidates.find((card) =>
      (!expectedLastFour || card.last_four_digits === expectedLastFour) &&
      (!expectedMonth || card.expiration_month === expectedMonth) &&
      (!expectedYear || card.expiration_year === expectedYear) &&
      (!expectedMethod || card.payment_method?.id === expectedMethod),
    ) ?? null
  );
}

/**
 * O vínculo de cartão do Mercado Pago pode responder 500 e concluir alguns
 * instantes depois. Reconsultamos a carteira para não reutilizar o token, que
 * é de uso único e sempre falharia numa segunda tentativa.
 */
async function waitForCustomerCard(
  accessToken: string,
  customerId: string,
  expected: MercadoPagoCard | null,
  knownCardIds: Set<string> = new Set(),
): Promise<MercadoPagoCard | null> {
  const delays = [0, 300, 900];
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const card = await findCustomerCard(accessToken, customerId, expected, knownCardIds);
    if (card?.id) return card;
  }
  return null;
}

/** Busca novamente a cobrança, pois a resposta inicial pode omitir card.id. */
async function paymentCard(
  accessToken: string,
  paymentId: string | number,
): Promise<MercadoPagoCard | null> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const responseBody = await readMpResponse(response);
  if (!response.ok) {
    logMpFailure("consulta da cobrança para salvar cartão", response, responseBody);
    return null;
  }
  const detail = responseBody.payload as { card?: MercadoPagoCard };
  return detail.card?.id ? detail.card : null;
}

async function saveCard(
  collector: Collector,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  userId: string,
  barbershopId: string,
  customerId: string,
  cardToken: string,
  cardNumber?: string | null,
  makeDefault = false,
) {
  const { data: knownRows } = await admin
    .from("saved_cards")
    .select("mp_card_id")
    .eq("user_id", userId)
    .eq("mp_collector_id", collector.collectorId);
  const knownCardIds = new Set(
    ((knownRows ?? []) as Array<{ mp_card_id?: string | null }>)
      .map((row) => row.mp_card_id)
      .filter((id): id is string => Boolean(id)),
  );
  const expected = await inspectCardToken(collector.accessToken, cardToken);
  const linked = await linkCardToCustomer(collector.accessToken, customerId, cardToken);
  const linkedCard =
    "error" in linked
      ? await waitForCustomerCard(collector.accessToken, customerId, expected, knownCardIds)
      : linked.card;
  if (!linkedCard?.id) return linked;

  return persistSavedCard(
    collector,
    admin,
    userId,
    barbershopId,
    customerId,
    linkedCard,
    cardNumber,
    makeDefault,
  );
}

/** Consome um token exclusivo e vincula o cartão ao customer recebedor. */
async function linkCardToCustomer(
  accessToken: string,
  customerId: string,
  cardToken: string,
) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(customerId)}/cards`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ token: cardToken }),
    },
  );
  const responseBody = await readMpResponse(response);
  const card = responseBody.payload as MercadoPagoCard;
  if (!response.ok || !card.id) {
    logMpFailure("vínculo do cartão ao customer", response, responseBody, {
      token: "[REDACTED_CARD_TOKEN]",
    });
    return {
      error: card.message ?? "Não foi possível salvar este cartão.",
      detail: mpDetail(card, response.status),
    } as const;
  }
  return { card } as const;
}

/** Grava localmente um cartão que o Mercado Pago já vinculou ao customer. */
async function persistSavedCard(
  collector: Collector,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  userId: string,
  barbershopId: string,
  customerId: string,
  card: MercadoPagoCard,
  cardNumber?: string | null,
  makeDefault = false,
) {
  if (!card.id) return { error: "O Mercado Pago não retornou o cartão salvo." } as const;

  const row = {
    user_id: userId,
    barbershop_id: barbershopId,
    mp_collector_id: collector.collectorId,
    mp_customer_id: customerId,
    mp_card_id: card.id,
    last_four: card.last_four_digits ?? null,
    brand: normalizeBrand(
      card.payment_method?.name ?? card.payment_method?.id ?? null,
      cardNumber,
    ),
    cardholder_name: card.cardholder?.name ?? null,
    expiration_month: card.expiration_month ?? null,
    expiration_year: card.expiration_year ?? null,
  };
  const { data, error } = await admin
    .from("saved_cards")
    .upsert(row, { onConflict: "user_id,mp_collector_id,mp_card_id" })
    .select("id, last_four, brand, cardholder_name, expiration_month, expiration_year")
    .maybeSingle();
  if (error) {
    console.error("Mercado Pago: falha ao gravar cartão salvo", error);
    return { error: "Não foi possível salvar este cartão.", detail: error.message } as const;
  }

  // Cartão padrão: o primeiro salvo vira padrão automaticamente; o cliente
  // também pode pedir explicitamente que este passe a ser o padrão.
  const savedId = (data as { id?: string } | null)?.id;
  if (savedId) {
    try {
      const { count } = await admin
        .from("saved_cards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_default", true);
      if (makeDefault || !count) {
        await admin.from("saved_cards").update({ is_default: false }).eq("user_id", userId);
        await admin.from("saved_cards").update({ is_default: true }).eq("id", savedId);
      }
    } catch (defaultError) {
      console.warn("Mercado Pago: cartão salvo, mas padrão não foi definido", defaultError);
    }
  }
  return { card: data } as const;
}

/** Token de acesso da conta dona do customer (barbeiro ou barbearia). */
async function tokenForCollector(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  collectorId: string,
  barbershopId: string | null,
): Promise<string | null> {
  const { data: barber } = await admin
    .from("barbers")
    .select("mp_access_token")
    .eq("mp_user_id", collectorId)
    .maybeSingle();
  if ((barber as { mp_access_token?: string } | null)?.mp_access_token) {
    return (barber as { mp_access_token: string }).mp_access_token;
  }
  if (!barbershopId) return null;
  const { data: shop } = await admin
    .from("barbershops")
    .select("mp_access_token")
    .eq("id", barbershopId)
    .maybeSingle();
  return (shop as { mp_access_token?: string } | null)?.mp_access_token ?? null;
}

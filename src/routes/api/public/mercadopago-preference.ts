import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { mpPlatformCredentials, mpEnvGuardError } from "@/lib/mp-platform.server";
import { mpNotificationUrl } from "@/lib/mp-webhook.server";
import { PAYER_EMAIL_ERROR, resolvePayerEmail } from "@/lib/mp-payer.server";
import { PUBLIC_APP_URL } from "@/lib/app-url";

/**
 * Checkout Pro: cria uma Preferência de Pagamento e devolve a init_point
 * (URL hospedada pelo Mercado Pago, com PIX e cartão no mesmo fluxo).
 * O status final continua sendo confirmado pelo webhook em segundo plano.
 */

const requestSchema = z.object({
  appointment_id: z.string().uuid(),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const INTERNAL_HOST_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "id-preview--",
  "-dev.lovable.app",
  "lovableproject.com",
  "lovable.dev",
  "sandbox",
];

/** Origem pública e HTTPS para as back_urls (o MP recusa domínios internos). */
function publicOrigin(requestUrl: string): string {
  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/+$/, "");
  const candidates = [appUrl, (() => {
    try {
      return new URL(requestUrl).origin;
    } catch {
      return "";
    }
  })()];
  for (const origin of candidates) {
    if (!origin) continue;
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:") continue;
      if (INTERNAL_HOST_PATTERNS.some((p) => url.hostname.includes(p))) continue;
      return origin;
    } catch {
      /* ignora */
    }
  }
  return PUBLIC_APP_URL;
}

export const Route = createFileRoute("/api/public/mercadopago-preference")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // A sessão é opcional: clientes anônimos também podem pagar o agendamento.
          const authorization = request.headers.get("authorization") ?? "";
          const hasSession = authorization.startsWith("Bearer ");


          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados do pagamento inválidos." }, 400);

          const envError = mpEnvGuardError();
          if (envError) return json({ error: envError }, 503);

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
            console.error("Checkout Pro: credenciais do banco ausentes no servidor");
            return json({ error: "O pagamento está temporariamente indisponível." }, 503);
          }

          let sessionEmail: string | null = null;
          if (hasSession) {
            const asUser = createClient(supabaseUrl, publishableKey, {
              global: { headers: { Authorization: authorization } },
              auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data: userData } = await asUser.auth.getUser();
            sessionEmail = userData.user?.email?.trim().toLowerCase() ?? null;
          }


          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const BASE_COLUMNS = "id, service_id, barber_id, barbershop_id, customer_name, email";
          let appointmentQuery = await admin
            .from("appointments")
            .select(`${BASE_COLUMNS}, payment_status, mp_payment_id`)
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          let paymentColumnsAvailable = true;
          if (appointmentQuery.error) {
            paymentColumnsAvailable = false;
            appointmentQuery = await admin
              .from("appointments")
              .select(BASE_COLUMNS)
              .eq("id", parsed.data.appointment_id)
              .maybeSingle();
          }
          if (appointmentQuery.error) {
            console.error("Checkout Pro: falha ao buscar agendamento", appointmentQuery.error);
            return json({ error: "Não foi possível localizar o agendamento." }, 500);
          }

          const appointment = appointmentQuery.data as {
            id: string;
            service_id: string;
            barber_id: string | null;
            barbershop_id: string | null;
            customer_name: string | null;
            email: string | null;
            payment_status?: string | null;
            mp_payment_id?: string | null;
          } | null;
          if (!appointment) return json({ error: "Agendamento não encontrado." }, 404);

          const appointmentEmail = String(appointment.email ?? "")
            .trim()
            .toLowerCase();
          // Sem sessão usamos o e-mail do agendamento; se nada existir, um e-mail
          // técnico válido é suficiente para o Checkout Pro (o pagador informa o dele lá).
          const payerEmail =
            resolvePayerEmail(sessionEmail, appointmentEmail) ??
            `cliente+${appointment.id.slice(0, 8)}@charm-barber.app`;

          if (appointment.payment_status === "pago") {
            return json({ error: "Este agendamento já está pago.", payment_status: "pago" }, 409);
          }
          if (!appointment.barbershop_id) {
            return json({ error: "O agendamento não está vinculado a uma barbearia." }, 400);
          }

          const { data: shop, error: shopError } = await admin
            .from("barbershops")
            .select("mp_access_token, payout_mode")
            .eq("id", appointment.barbershop_id)
            .maybeSingle();
          if (shopError) {
            console.error("Checkout Pro: falha ao buscar barbearia", shopError);
            return json({ error: "Não foi possível carregar a conta de pagamento." }, 500);
          }

          // Split por subcontas: cobra na conta do barbeiro e repassa a taxa da barbearia.
          let barberSplit: { accessToken: string; commissionPercent: number } | null = null;
          if (shop?.payout_mode === "split" && appointment.barber_id) {
            const { data: barber } = await admin
              .from("barbers")
              .select("mp_access_token, commission_percent")
              .eq("id", appointment.barber_id)
              .maybeSingle();
            const token = (barber as { mp_access_token?: string | null } | null)?.mp_access_token;
            if (token) {
              const raw = Number(
                (barber as { commission_percent?: number | null }).commission_percent ?? 0,
              );
              barberSplit = {
                accessToken: token,
                commissionPercent: Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0)),
              };
            }
          }

          const platform = mpPlatformCredentials();

          /** Candidatos de token, do mais específico ao token da plataforma. */
          type TokenCandidate = {
            token: string;
            source: "barber" | "shop" | "platform";
          };
          const seen = new Set<string>();
          const candidates: TokenCandidate[] = [];
          const pushCandidate = (
            value: string | null | undefined,
            source: TokenCandidate["source"],
          ) => {
            const token = String(value ?? "").trim();
            // Chaves de teste nunca são aceitas em produção.
            if (!token || token.toUpperCase().startsWith("TEST-") || seen.has(token)) return;
            seen.add(token);
            candidates.push({ token, source });
          };
          if (barberSplit) pushCandidate(barberSplit.accessToken, "barber");
          pushCandidate(shop?.mp_access_token, "shop");
          // Sempre disponível como fallback: MP_ACCESS_TOKEN de produção (lido a cada request,
          // sem cache de módulo, para que uma troca de credencial valha imediatamente).
          pushCandidate(platform?.accessToken, "platform");

          if (candidates.length === 0) {
            return json(
              {
                error:
                  shop?.payout_mode === "split"
                    ? "Este profissional ainda não conectou o Mercado Pago."
                    : "Esta barbearia ainda não conectou o Mercado Pago.",
              },
              400,
            );
          }


          const { data: service } = await admin
            .from("services")
            .select("name, price")
            .eq("id", appointment.service_id)
            .maybeSingle();
          if (!service) return json({ error: "Serviço do agendamento não encontrado." }, 404);

          const amount = Number((service as { price?: number | null }).price ?? 0);
          if (!(amount > 0)) return json({ error: "O serviço não possui um preço válido." }, 400);

          const shopFee = barberSplit
            ? Number(((amount * (100 - barberSplit.commissionPercent)) / 100).toFixed(2))
            : 0;

          const origin = publicOrigin(request.url);
          const backUrl = `${origin}/pagamento-confirmado/${appointment.id}`;
          const attemptId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
          const externalReference = `${appointment.id}:${attemptId}`;

          const preferenceBody: Record<string, unknown> = {
            items: [
              {
                id: appointment.service_id,
                title: String((service as { name?: string }).name ?? "Serviço"),
                description: "Agendamento na barbearia",
                quantity: 1,
                currency_id: "BRL",
                unit_price: Number(amount.toFixed(2)),
              },
            ],
            payer: {
              email: payerEmail,
              name: String(appointment.customer_name ?? "Cliente").split(" ")[0],
            },
            external_reference: externalReference,
            notification_url: mpNotificationUrl(request.url),
            back_urls: {
              success: `${backUrl}?status=success`,
              pending: `${backUrl}?status=pending`,
              failure: `${backUrl}?status=failure`,
            },
            auto_return: "approved",
            // Libera explicitamente Pix, cartão de crédito e débito (sem exclusões).
            payment_methods: {
              excluded_payment_methods: [],
              excluded_payment_types: [],
              installments: 12,
              default_installments: 1,
            },
            binary_mode: false,
            statement_descriptor: "BARBEARIA",
            metadata: {
              appointment_id: appointment.id,
              payout_mode: barberSplit ? "split" : "unica",
              barber_id: appointment.barber_id ?? null,
              commission_percent: barberSplit?.commissionPercent ?? null,
            },
          };
          if (shopFee > 0) preferenceBody["marketplace_fee"] = shopFee;

          const createPreference = (body: Record<string, unknown>, token: string) =>
            fetch("https://api.mercadopago.com/checkout/preferences", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                accept: "application/json",
                "content-type": "application/json",
                "cache-control": "no-cache",
                "X-Idempotency-Key": `pref-${externalReference}`,
              },
              body: JSON.stringify(body),
            });

          /** Marca como inválido um token OAuth guardado no banco (barbeiro/barbearia). */
          const invalidateStoredToken = async (source: "barber" | "shop") => {
            try {
              if (source === "barber" && appointment.barber_id) {
                await admin
                  .from("barbers")
                  .update({ mp_access_token: null })
                  .eq("id", appointment.barber_id);
              } else if (source === "shop" && appointment.barbershop_id) {
                await admin
                  .from("barbershops")
                  .update({ mp_access_token: null })
                  .eq("id", appointment.barbershop_id);
              }
            } catch (e) {
              console.error("Checkout Pro: falha ao limpar token inválido", e);
            }
          };

          type PreferenceResponse = {
            id?: string;
            init_point?: string;
            sandbox_init_point?: string;
            message?: string;
            error?: string;
          };

          let response: Response | null = null;
          let preference: PreferenceResponse = {};
          let lastError = "Não foi possível iniciar o pagamento online.";

          // Validação prévia: confirma que cada token responde em /users/me antes de
          // tentar criar a preferência. Tokens inválidos são descartados (e limpos do
          // banco quando vieram do OAuth), evitando o erro genérico "invalid access token".
          const validCandidates: typeof candidates = [];
          let tokenError = "";
          for (const candidate of candidates) {
            let ok = false;
            try {
              const meRes = await fetch("https://api.mercadopago.com/users/me", {
                headers: {
                  Authorization: `Bearer ${candidate.token}`,
                  accept: "application/json",
                  "cache-control": "no-cache",
                },
              });
              ok = meRes.ok;
              if (!ok) {
                const meBody = (await meRes.json().catch(() => ({}))) as {
                  message?: string;
                  error?: string;
                };
                tokenError = String(meBody.message ?? meBody.error ?? `HTTP ${meRes.status}`);
                console.error("Checkout Pro: token inválido na validação prévia", {
                  source: candidate.source,
                  status: meRes.status,
                  message: tokenError,
                });
                if (candidate.source !== "platform" && (meRes.status === 401 || meRes.status === 403)) {
                  await invalidateStoredToken(candidate.source);
                }
              }
            } catch (e) {
              // Falha de rede: não invalida o token, apenas segue e tenta criar a preferência.
              console.warn("Checkout Pro: validação prévia indisponível", (e as Error).message);
              ok = true;
            }
            if (ok) validCandidates.push(candidate);
          }

          if (validCandidates.length === 0) {
            return json(
              {
                error:
                  "Credencial do Mercado Pago inválida ou expirada. Atualize o MP_ACCESS_TOKEN de produção (ou reconecte a conta do Mercado Pago).",
                detail: tokenError || undefined,
              },
              503,
            );
          }

          for (const candidate of validCandidates) {
            const body = { ...preferenceBody };
            let res = await createPreference(body, candidate.token);

            // marketplace_fee só funciona em contas habilitadas: tenta de novo sem split.
            if (!res.ok && shopFee > 0) {
              const text = await res
                .clone()
                .text()
                .catch(() => "");
              if (text.includes("marketplace")) {
                console.warn("Checkout Pro: marketplace_fee recusado, recriando sem split");
                delete body["marketplace_fee"];
                res = await createPreference(body, candidate.token);
              }
            }

            const parsedBody = (await res.json().catch(() => ({}))) as PreferenceResponse;

            if (res.ok && parsedBody.init_point) {
              response = res;
              preference = parsedBody;
              break;
            }

            const message = String(parsedBody.message ?? parsedBody.error ?? "");
            const invalidToken =
              res.status === 401 ||
              res.status === 403 ||
              /invalid[_ ]access[_ ]token|unauthorized|invalid_token/i.test(message);

            console.error("Checkout Pro: preferência recusada", {
              source: candidate.source,
              status: res.status,
              message,
            });
            lastError = message || lastError;

            if (invalidToken && candidate.source !== "platform") {
              // Token OAuth vencido/revogado: limpa para não ser reutilizado e cai no próximo.
              await invalidateStoredToken(candidate.source);
              continue;
            }
            if (invalidToken) {
              return json(
                {
                  error:
                    "Credencial do Mercado Pago inválida. Verifique o MP_ACCESS_TOKEN de produção.",
                },
                503,
              );
            }
            return json({ error: message || lastError }, 400);
          }

          // Checkout Pro: usamos sempre a URL hospedada pelo Mercado Pago.
          const checkoutUrl = preference.init_point || preference.sandbox_init_point || null;
          if (!response || !checkoutUrl) {
            return json({ error: lastError }, 400);
          }


          // Guarda a referência da preferência já na criação do Checkout Pro:
          // sem isso o agendamento fica sem identificador do MP até o webhook chegar.
          let referenceSaved = false;
          if (paymentColumnsAvailable) {
            const current = String(appointment.mp_payment_id ?? "");
            const reference = preference.id ? `pref:${preference.id}` : null;
            const shouldSaveReference = Boolean(
              reference && (!current || current.startsWith("pref:")),
            );
            const patch: Record<string, unknown> = {
              payment_status: "pendente",
              payment_method: "online",
            };
            if (shouldSaveReference && reference) patch["mp_payment_id"] = reference;

            // Retry curto: a gravação precisa acontecer antes de redirecionar o cliente.
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              const { data: saved, error } = await admin
                .from("appointments")
                .update(patch)
                .eq("id", appointment.id)
                .select("mp_payment_id, payment_status")
                .maybeSingle();

              const savedRef = String(
                (saved as { mp_payment_id?: string | null } | null)?.mp_payment_id ?? "",
              );
              if (!error && (!shouldSaveReference || savedRef === reference)) {
                referenceSaved = shouldSaveReference;
                break;
              }
              console.error(
                `Checkout Pro: tentativa ${attempt} de salvar a referência falhou`,
                error ?? { savedRef, reference },
              );
              if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
            }

            if (shouldSaveReference && !referenceSaved) {
              console.error("Checkout Pro: referência da preferência não persistida", {
                appointment_id: appointment.id,
                preference_id: preference.id,
              });
            }
          }

          return json({
            preference_id: preference.id,
            init_point: checkoutUrl,
            amount: Number(amount.toFixed(2)),
            reference_saved: referenceSaved,
          });
        } catch (error) {
          console.error("Checkout Pro: erro inesperado", error);
          return json({ error: "Não foi possível iniciar o pagamento online." }, 500);
        }
      },
    },
  },
});

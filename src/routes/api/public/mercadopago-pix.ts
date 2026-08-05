import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    appointment_id: z.string().uuid(),
    force_new: z.boolean().optional(),
  }),
  // Checkout com cartão de crédito (Checkout Pro), mesmo split do PIX.
  z.object({
    action: z.literal("card"),
    appointment_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("status"),
    appointment_id: z.string().uuid(),
    payment_id: z.union([z.string().min(1).max(80), z.number().int().positive()]),
  }),
]);

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Traduz o status do Mercado Pago para o status usado no app. */
export function mapPaymentStatus(mpStatus?: string | null): string {
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

/** Atualiza o pagamento sem quebrar caso as colunas ainda não existam. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function savePayment(
  admin: { from: (table: string) => any },
  enabled: boolean,
  appointmentId: string,
  values: Record<string, unknown>,
) {
  if (!enabled) return;
  const { error } = await admin.from("appointments").update(values).eq("id", appointmentId);
  if (error) console.error("Mercado Pago PIX: falha ao salvar status do pagamento", error);
}

export const Route = createFileRoute("/api/public/mercadopago-pix")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente para continuar." }, 401);
          }

          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados do pagamento inválidos." }, 400);

          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"];
          const publishableKey =
            process.env["SUPABASE_PUBLISHABLE_KEY"] ||
            process.env["SB_PUBLISHABLE_KEY"] ||
            process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
          const serviceKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];

          if (!supabaseUrl || !publishableKey || !serviceKey) {
            console.error("Mercado Pago PIX: credenciais do banco ausentes no servidor");
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

          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const BASE_COLUMNS = "id, service_id, barber_id, barbershop_id, customer_name, email";
          const PAYMENT_COLUMNS = `${BASE_COLUMNS}, payment_status, mp_payment_id`;

          // As colunas de pagamento podem ainda não existir no banco: cai para as básicas.
          let appointmentQuery = await admin
            .from("appointments")
            .select(PAYMENT_COLUMNS)
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

          const appointment = appointmentQuery.data as
            | {
                id: string;
                service_id: string;
                barber_id: string | null;
                barbershop_id: string | null;
                customer_name: string | null;
                email: string | null;
                payment_status?: string | null;
                mp_payment_id?: string | null;
              }
            | null;

          if (appointmentQuery.error) {
            console.error("Mercado Pago PIX: falha ao buscar agendamento", appointmentQuery.error);
            return json({ error: "Não foi possível localizar o agendamento." }, 500);
          }
          if (!appointment) return json({ error: "Agendamento não encontrado." }, 404);

          const userEmail = userData.user.email?.trim().toLowerCase();
          const appointmentEmail = String(appointment.email ?? "").trim().toLowerCase();
          if (!userEmail || !appointmentEmail || userEmail !== appointmentEmail) {
            return json({ error: "Você não tem acesso a este agendamento." }, 403);
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
            console.error("Mercado Pago PIX: falha ao buscar barbearia", shopError);
            return json({ error: "Não foi possível carregar a conta de pagamento." }, 500);
          }

          // Split por subcontas: cobra na conta do próprio barbeiro e repassa a
          // parte da barbearia via application_fee.
          let barberSplit: { accessToken: string; commissionPercent: number } | null = null;
          if (shop?.payout_mode === "split" && appointment.barber_id) {
            const { data: barber, error: barberError } = await admin
              .from("barbers")
              .select("mp_access_token, commission_percent")
              .eq("id", appointment.barber_id)
              .maybeSingle();
            if (barberError) {
              console.error("Mercado Pago PIX: falha ao buscar barbeiro", barberError);
            } else if ((barber as { mp_access_token?: string | null } | null)?.mp_access_token) {
              const raw = Number(
                (barber as { commission_percent?: number | null }).commission_percent ?? 0,
              );
              barberSplit = {
                accessToken: (barber as { mp_access_token: string }).mp_access_token,
                commissionPercent: Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0)),
              };
            }
          }

          const accessToken = barberSplit?.accessToken ?? shop?.mp_access_token;
          if (!accessToken) {
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


          if (parsed.data.action === "status") {
            const paymentResponse = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(parsed.data.payment_id))}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            const payment = (await paymentResponse.json().catch(() => ({}))) as {
              status?: string;
              status_detail?: string;
              message?: string;
            };
            if (!paymentResponse.ok) {
              console.error("Mercado Pago PIX: consulta recusada", paymentResponse.status, payment);
              return json({ error: payment.message ?? "Falha ao consultar o pagamento." }, 400);
            }

            const paymentStatus = mapPaymentStatus(payment.status);
            await savePayment(admin, paymentColumnsAvailable, appointment.id, {
              payment_status: paymentStatus,
              payment_method: "pix",
              mp_payment_id: String(parsed.data.payment_id),
              paid_at: paymentStatus === "pago" ? new Date().toISOString() : null,
            });

            return json({
              status: payment.status,
              status_detail: payment.status_detail,
              payment_status: paymentStatus,
            });
          }

          // ---- action === "create" ----
          const { data: service, error: serviceError } = await admin
            .from("services")
            .select("name, price")
            .eq("id", appointment.service_id)
            .maybeSingle();
          if (serviceError || !service) {
            return json({ error: "Serviço do agendamento não encontrado." }, 404);
          }

          if (appointment.payment_status === "pago") {
            return json({ error: "Este agendamento já está pago.", payment_status: "pago" }, 409);
          }

          const amount = Number(service.price ?? 0);
          if (!(amount > 0)) return json({ error: "O serviço não possui um preço válido." }, 400);

          // No split, a barbearia fica com (100 - comissão do barbeiro).
          const shopFee = barberSplit
            ? Number(((amount * (100 - barberSplit.commissionPercent)) / 100).toFixed(2))
            : 0;

          // ---- action === "card": Checkout Pro (cartão de crédito) ----
          if (parsed.data.action === "card") {
            const origin = new URL(request.url).origin;
            const backUrl = `${origin}/pagamento/${appointment.id}`;
            const preferenceBody: Record<string, unknown> = {
              items: [
                {
                  id: appointment.service_id,
                  title: `${service.name ?? "Serviço"} — agendamento`,
                  quantity: 1,
                  currency_id: "BRL",
                  unit_price: Number(amount.toFixed(2)),
                },
              ],
              external_reference: appointment.id,
              payer: { email: userEmail, name: appointment.customer_name ?? "Cliente" },
              back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
              auto_return: "approved",
              notification_url: `${origin}/api/public/mercadopago-webhook`,
              // Só cartão de crédito neste fluxo (PIX tem botão próprio).
              payment_methods: {
                excluded_payment_types: [
                  { id: "ticket" },
                  { id: "bank_transfer" },
                  { id: "atm" },
                  { id: "debit_card" },
                ],
              },
              metadata: {
                appointment_id: appointment.id,
                payout_mode: barberSplit ? "split" : "unica",
                barber_id: appointment.barber_id ?? null,
                commission_percent: barberSplit?.commissionPercent ?? null,
              },
            };
            // Split por subcontas: a taxa da plataforma na preferência é `marketplace_fee`.
            if (shopFee > 0) preferenceBody["marketplace_fee"] = shopFee;

            const createPreference = (body: Record<string, unknown>) =>
              fetch("https://api.mercadopago.com/checkout/preferences", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "content-type": "application/json",
                  "X-Idempotency-Key": `pref-${appointment.id}-${Date.now()}`,
                },
                body: JSON.stringify(body),
              });

            let prefResponse = await createPreference(preferenceBody);
            if (!prefResponse.ok && shopFee > 0) {
              const detail = JSON.stringify(
                await prefResponse
                  .clone()
                  .json()
                  .catch(() => ({}) as Record<string, unknown>),
              );
              if (detail.includes("marketplace") || detail.includes("fee")) {
                console.warn("Mercado Pago cartão: taxa recusada, recriando sem split", detail);
                delete preferenceBody["marketplace_fee"];
                prefResponse = await createPreference(preferenceBody);
              }
            }

            const preference = (await prefResponse.json().catch(() => ({}))) as {
              id?: string;
              init_point?: string;
              sandbox_init_point?: string;
              message?: string;
            };
            const checkoutUrl = preference.init_point ?? preference.sandbox_init_point;
            if (!prefResponse.ok || !checkoutUrl) {
              console.error("Mercado Pago cartão: preferência recusada", prefResponse.status, preference);
              return json(
                { error: preference.message ?? "Falha ao abrir o pagamento com cartão." },
                400,
              );
            }

            await savePayment(admin, paymentColumnsAvailable, appointment.id, {
              payment_status: "pendente",
              payment_method: "credit_card",
            });

            return json({ checkout_url: checkoutUrl, preference_id: preference.id, amount });
          }

          // Reaproveita o PIX anterior se ainda estiver válido (pendente e não expirado).
          if (!parsed.data.force_new && appointment.mp_payment_id) {
            const previousResponse = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(appointment.mp_payment_id)}`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            const previous = (await previousResponse.json().catch(() => ({}))) as {
              id?: number | string;
              status?: string;
              date_of_expiration?: string;
              point_of_interaction?: {
                transaction_data?: {
                  qr_code?: string;
                  qr_code_base64?: string;
                  ticket_url?: string;
                };
              };
            };
            const stillValid =
              previousResponse.ok &&
              previous.status === "pending" &&
              (!previous.date_of_expiration ||
                new Date(previous.date_of_expiration).getTime() > Date.now() + 60_000);
            if (stillValid && previous.id) {
              const tx = previous.point_of_interaction?.transaction_data;
              return json({
                payment_id: previous.id,
                status: previous.status ?? "pending",
                payment_status: "pendente",
                amount,
                reused: true,
                expires_at: previous.date_of_expiration ?? null,
                qr_code: tx?.qr_code ?? null,
                qr_code_base64: tx?.qr_code_base64 ?? null,
                ticket_url: tx?.ticket_url ?? null,
              });
            }
          }

          // Novo PIX: chave de idempotência única por tentativa, sempre no mesmo agendamento.
          const attemptKey = `appointment-${appointment.id}-${Date.now()}`;
          const expiresAt = new Date(Date.now() + 30 * 60_000);
          const paymentBody: Record<string, unknown> = {
            transaction_amount: Number(amount.toFixed(2)),
            description: `${service.name ?? "Serviço"} — agendamento`,
            payment_method_id: "pix",
            external_reference: appointment.id,
            date_of_expiration: expiresAt.toISOString(),
            metadata: {
              appointment_id: appointment.id,
              payout_mode: barberSplit ? "split" : "unica",
              barber_id: appointment.barber_id ?? null,
              commission_percent: barberSplit?.commissionPercent ?? null,
            },
            payer: {
              email: userEmail,
              first_name: String(appointment.customer_name ?? "Cliente").split(" ")[0],
            },
          };
          // API atual do Mercado Pago: a taxa da plataforma é `application_fee`
          // (`marketplace_fee` foi descontinuado e é rejeitado como parâmetro inválido).
          if (shopFee > 0) paymentBody["application_fee"] = shopFee;

          const createPayment = (body: Record<string, unknown>, key: string) =>
            fetch("https://api.mercadopago.com/v1/payments", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "content-type": "application/json",
                "X-Idempotency-Key": key,
              },
              body: JSON.stringify(body),
            });

          let paymentResponse = await createPayment(paymentBody, attemptKey);
          if (!paymentResponse.ok && shopFee > 0) {
            const clone = await paymentResponse
              .clone()
              .json()
              .catch(() => ({}) as Record<string, unknown>);
            const msg = JSON.stringify(clone);
            // Conta sem marketplace habilitado: refaz sem a taxa para não bloquear o pagamento.
            if (msg.includes("application_fee") || msg.includes("marketplace")) {
              console.warn("Mercado Pago PIX: application_fee recusado, recriando sem split", msg);
              delete paymentBody["application_fee"];
              paymentResponse = await createPayment(paymentBody, `${attemptKey}-nofee`);
            }
          }

          const payment = (await paymentResponse.json().catch(() => ({}))) as {
            id?: number | string;
            status?: string;
            status_detail?: string;
            message?: string;
            date_of_expiration?: string;
            point_of_interaction?: {
              transaction_data?: {
                qr_code?: string;
                qr_code_base64?: string;
                ticket_url?: string;
              };
            };
          };
          if (!paymentResponse.ok || !payment.id) {
            console.error("Mercado Pago PIX: criação recusada", paymentResponse.status, payment);
            return json(
              {
                error: paymentErrorMessage(payment.status_detail, payment.status, payment.message),
              },
              400,
            );
          }

          await savePayment(admin, paymentColumnsAvailable, appointment.id, {
            payment_status: mapPaymentStatus(payment.status),
            payment_method: "pix",
            mp_payment_id: String(payment.id),
            paid_at: null,
          });

          const transaction = payment.point_of_interaction?.transaction_data;
          return json({
            payment_id: payment.id,
            status: payment.status ?? "pending",
            payment_status: mapPaymentStatus(payment.status),
            amount,
            reused: false,
            expires_at: payment.date_of_expiration ?? expiresAt.toISOString(),
            qr_code: transaction?.qr_code ?? null,
            qr_code_base64: transaction?.qr_code_base64 ?? null,
            ticket_url: transaction?.ticket_url ?? null,
          });
        } catch (error) {
          console.error("Mercado Pago PIX: erro inesperado", error);
          return json({ error: "Não foi possível processar o PIX agora." }, 500);
        }
      },
    },
  },
});

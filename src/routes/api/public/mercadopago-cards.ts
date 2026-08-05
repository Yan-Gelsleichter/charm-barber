import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("config"), appointment_id: z.string().uuid() }),
  z.object({ action: z.literal("list"), appointment_id: z.string().uuid() }),
  z.object({
    action: z.literal("save"),
    appointment_id: z.string().uuid(),
    card_token: z.string().min(10).max(120),
    card_number: z.string().min(12).max(25).optional(),
    expiration_month: z.number().int().min(1).max(12).optional(),
    expiration_year: z.number().int().min(2000).max(2100).optional(),
  }),
  z.object({
    action: z.literal("pay"),
    appointment_id: z.string().uuid(),
    card_token: z.string().min(10).max(120),
    saved_card_id: z.string().uuid().optional(),
    installments: z.number().int().min(1).max(12).optional(),
    save_card: z.boolean().optional(),
    card_number: z.string().min(12).max(25).optional(),
    expiration_month: z.number().int().min(1).max(12).optional(),
    expiration_year: z.number().int().min(2000).max(2100).optional(),
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
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as {
    status?: string;
    expiration_month?: number;
    expiration_year?: number;
    last_four_digits?: string;
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
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

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
                "id, last_four, brand, cardholder_name, expiration_month, expiration_year, is_default, created_at",
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
            .select("id, mp_access_token, mp_public_key, mp_user_id, payout_mode")
            .eq("id", appointment.barbershop_id)
            .maybeSingle();
          const shopRow = shop as {
            id: string;
            mp_access_token?: string | null;
            mp_public_key?: string | null;
            mp_user_id?: string | null;
            payout_mode?: string | null;
          } | null;

          let collector: Collector | null = null;
          if (shopRow?.payout_mode === "split" && appointment.barber_id) {
            const { data: barber } = await admin
              .from("barbers")
              .select("id, mp_access_token, mp_public_key, mp_user_id, commission_percent")
              .eq("id", appointment.barber_id)
              .maybeSingle();
            const b = barber as {
              id: string;
              mp_access_token?: string | null;
              mp_public_key?: string | null;
              mp_user_id?: string | null;
              commission_percent?: number | null;
            } | null;
            if (b?.mp_access_token) {
              const raw = Number(b.commission_percent ?? 0);
              const pct = Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
              collector = {
                accessToken: b.mp_access_token,
                publicKey: b.mp_public_key ?? null,
                collectorId: b.mp_user_id ?? `barber:${b.id}`,
                shopFee: Number(((amount * (100 - pct)) / 100).toFixed(2)),
              };
            }
          }
          if (!collector && shopRow?.mp_access_token) {
            collector = {
              accessToken: shopRow.mp_access_token,
              publicKey: shopRow.mp_public_key ?? null,
              collectorId: shopRow.mp_user_id ?? `shop:${shopRow.id}`,
              shopFee: 0,
            };
          }
          if (!collector) {
            return json({ error: "Esta barbearia ainda não conectou o Mercado Pago." }, 400);
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
                "id, last_four, brand, cardholder_name, expiration_month, expiration_year, is_default",
              )
              .eq("user_id", user.id)
              .eq("mp_collector_id", collector.collectorId)
              .order("is_default", { ascending: false })
              .order("created_at", { ascending: false });
            if (error) {
              // Banco ainda sem a coluna is_default: cai para a listagem simples.
              const { data: legacy } = await admin
                .from("saved_cards")
                .select("id, last_four, brand, cardholder_name, expiration_month, expiration_year")
                .eq("user_id", user.id)
                .eq("mp_collector_id", collector.collectorId)
                .order("created_at", { ascending: false });
              return json({ cards: legacy ?? [] });
            }
            return json({ cards: data ?? [] });
          }

          const customerId = await ensureCustomer(collector.accessToken, userEmail, {
            name: appointment.customer_name,
          });
          if (!customerId) {
            return json({ error: "Não foi possível preparar o cadastro do cartão." }, 400);
          }

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
            );
            if ("error" in saved) return json({ error: saved.error }, 400);
            return json({ card: saved.card });
          }


          // ---- pagar (1 clique com cartão salvo ou cartão novo) ----
          if (parsed.data.saved_card_id) {
            // O cartão salvo precisa ser do próprio usuário e da mesma conta recebedora.
            const { data: owned } = await admin
              .from("saved_cards")
              .select("id, expiration_month, expiration_year")
              .eq("id", parsed.data.saved_card_id)
              .eq("user_id", user.id)
              .eq("mp_collector_id", collector.collectorId)
              .maybeSingle();
            if (!owned) return json({ error: "Cartão não encontrado." }, 404);
            const stored = owned as { expiration_month?: number; expiration_year?: number };
            if (
              (stored.expiration_month || stored.expiration_year) &&
              !expiryValid(stored.expiration_month, stored.expiration_year)
            ) {
              return json({ error: "Cartão salvo vencido. Atualize a validade." }, 400);
            }
          }
          if (!(amount > 0)) return json({ error: "O serviço não possui um preço válido." }, 400);

          if (appointment.payment_status === "pago") {
            return json({ error: "Este agendamento já está pago.", payment_status: "pago" }, 409);
          }

          const body: Record<string, unknown> = {
            transaction_amount: Number(amount.toFixed(2)),
            token: parsed.data.card_token,
            description: `${(service as { name?: string } | null)?.name ?? "Serviço"} — agendamento`,
            installments: parsed.data.installments ?? 1,
            payer: { type: "customer", id: customerId, email: userEmail },
            external_reference: appointment.id,
            metadata: {
              appointment_id: appointment.id,
              barber_id: appointment.barber_id ?? null,
            },
          };
          if (collector.shopFee > 0) body["application_fee"] = collector.shopFee;

          const doPay = (payload: Record<string, unknown>, key: string) =>
            fetch("https://api.mercadopago.com/v1/payments", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${collector.accessToken}`,
                "content-type": "application/json",
                "X-Idempotency-Key": key,
              },
              body: JSON.stringify(payload),
            });

          const key = `card-${appointment.id}-${Date.now()}`;
          let response = await doPay(body, key);
          if (!response.ok && collector.shopFee > 0) {
            const detail = JSON.stringify(await response.clone().json().catch(() => ({})));
            if (detail.includes("application_fee") || detail.includes("marketplace")) {
              delete body["application_fee"];
              response = await doPay(body, `${key}-nofee`);
            }
          }
          const payment = (await response.json().catch(() => ({}))) as {
            id?: number | string;
            status?: string;
            status_detail?: string;
            message?: string;
          };
          if (!response.ok || !payment.id) {
            console.error("Mercado Pago cartão salvo: recusado", response.status, payment);
            return json({ error: payment.message ?? "Pagamento recusado pelo emissor." }, 400);
          }

          const paymentStatus = mapPaymentStatus(payment.status);
          const { error: updateError } = await admin
            .from("appointments")
            .update({
              payment_status: paymentStatus,
              payment_method: "credit_card",
              mp_payment_id: String(payment.id),
              paid_at: paymentStatus === "pago" ? new Date().toISOString() : null,
            })
            .eq("id", appointment.id);
          if (updateError) console.error("Cartão salvo: falha ao gravar status", updateError);

          // Salva o cartão novo só depois de aprovado, se o cliente pediu.
          if (parsed.data.save_card && !parsed.data.saved_card_id && paymentStatus === "pago") {
            await saveCard(
              collector,
              admin,
              user.id,
              appointment.barbershop_id,
              customerId,
              parsed.data.card_token,
            ).catch(() => null);
          }

          return json({
            payment_id: payment.id,
            status: payment.status,
            status_detail: payment.status_detail,
            payment_status: paymentStatus,
          });
        } catch (error) {
          console.error("Mercado Pago cartões: erro inesperado", error);
          return json({ error: "Não foi possível processar o cartão agora." }, 500);
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
): Promise<string | null> {
  const search = await fetch(
    `https://api.mercadopago.com/v1/customers/search?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const found = (await search.json().catch(() => ({}))) as {
    results?: Array<{ id?: string }>;
  };
  if (search.ok && found.results?.[0]?.id) return found.results[0].id as string;

  const created = await fetch("https://api.mercadopago.com/v1/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      email,
      first_name: String(extra.name ?? "Cliente").split(" ")[0],
    }),
  });
  const customer = (await created.json().catch(() => ({}))) as { id?: string };
  return customer.id ?? null;
}

/** Vincula o token de cartão ao customer e grava no banco. */
async function saveCard(
  collector: Collector,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  userId: string,
  barbershopId: string,
  customerId: string,
  cardToken: string,
) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(customerId)}/cards`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${collector.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ token: cardToken }),
    },
  );
  const card = (await response.json().catch(() => ({}))) as {
    id?: string;
    last_four_digits?: string;
    payment_method?: { name?: string; id?: string };
    cardholder?: { name?: string };
    expiration_month?: number;
    expiration_year?: number;
    message?: string;
  };
  if (!response.ok || !card.id) {
    console.error("Mercado Pago: falha ao salvar cartão", response.status, card);
    return { error: card.message ?? "Não foi possível salvar este cartão." } as const;
  }

  const row = {
    user_id: userId,
    barbershop_id: barbershopId,
    mp_collector_id: collector.collectorId,
    mp_customer_id: customerId,
    mp_card_id: card.id,
    last_four: card.last_four_digits ?? null,
    brand: card.payment_method?.name ?? card.payment_method?.id ?? null,
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
    return { error: "Não foi possível salvar este cartão." } as const;
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

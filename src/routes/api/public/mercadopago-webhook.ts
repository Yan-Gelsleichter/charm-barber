import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import { mapPaymentStatus } from "./mercadopago-pix";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

function isMissingColumn(error: { message?: string; code?: string } | null) {
  return !!error && (error.code === "42703" || /column .* does not exist/i.test(error.message ?? ""));
}

/** Busca o access token da conta que recebeu o pagamento (barbearia ou barbeiro no split). */
async function resolveAccessToken(
  admin: Admin,
  collectorId: string | null,
  paymentId: string,
): Promise<string | null> {
  if (collectorId) {
    const { data: barber } = await admin
      .from("barbers")
      .select("mp_access_token")
      .eq("mp_user_id", collectorId)
      .maybeSingle();
    const barberToken = (barber as { mp_access_token?: string | null } | null)?.mp_access_token;
    if (barberToken) return barberToken;

    const { data: shop } = await admin
      .from("barbershops")
      .select("mp_access_token")
      .eq("mp_user_id", collectorId)
      .maybeSingle();
    const shopToken = (shop as { mp_access_token?: string | null } | null)?.mp_access_token;
    if (shopToken) return shopToken;
  }

  // Fallback: agendamento já vinculado a esse pagamento.
  const { data: appt } = await admin
    .from("appointments")
    .select("barbershop_id, barber_id")
    .eq("mp_payment_id", paymentId)
    .maybeSingle();
  const row = appt as { barbershop_id?: string | null; barber_id?: string | null } | null;
  if (row?.barber_id) {
    const { data: barber } = await admin
      .from("barbers")
      .select("mp_access_token")
      .eq("id", row.barber_id)
      .maybeSingle();
    const token = (barber as { mp_access_token?: string | null } | null)?.mp_access_token;
    if (token) return token;
  }
  if (row?.barbershop_id) {
    const { data: shop } = await admin
      .from("barbershops")
      .select("mp_access_token")
      .eq("id", row.barbershop_id)
      .maybeSingle();
    const token = (shop as { mp_access_token?: string | null } | null)?.mp_access_token;
    if (token) return token;
  }
  return null;
}

function isMissingTable(error: { message?: string; code?: string } | null) {
  return !!error && (error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? ""));
}

function isDuplicate(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""));
}

/** Nome amigável do meio de pagamento (PIX, cartão, boleto...). */
function methodLabel(payment: { payment_type_id?: string; payment_method_id?: string }) {
  const type = (payment.payment_type_id ?? "").toLowerCase();
  if (type === "credit_card") return "cartao_credito";
  if (type === "debit_card") return "cartao_debito";
  if (type === "bank_transfer" || payment.payment_method_id === "pix") return "pix";
  return payment.payment_method_id ?? type ?? "outro";
}

type PaymentPayload = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  payment_type_id?: string;
  payment_method_id?: string;
  external_reference?: string;
  metadata?: { appointment_id?: string };
};

async function fetchPayment(accessToken: string, paymentId: string) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as PaymentPayload;
  return { ok: res.ok, status: res.status, payment: body };
}

/** Aplica o status de um pagamento (PIX ou cartão) no agendamento, com idempotência. */
async function applyPayment(
  admin: Admin,
  payment: PaymentPayload,
  paymentId: string,
  eventId: string,
) {
  const appointmentId = payment.external_reference || payment.metadata?.appointment_id;
  if (!appointmentId) return new Response("no appointment", { status: 200 });

  // aprovado -> pago | pendente | estornado (refunded/charged_back) | cancelado/expirado/falhou
  const paymentStatus = mapPaymentStatus(payment.status);

  // Idempotência: registra o evento antes de aplicar. Se já existe, o Mercado Pago
  // reenviou a mesma notificação e nada é atualizado de novo.
  let claimed = false;
  const { error: claimError } = await admin.from("mp_webhook_events").insert({
    event_id: eventId,
    payment_id: paymentId,
    appointment_id: appointmentId,
    status: paymentStatus,
  });
  if (claimError) {
    if (isDuplicate(claimError)) {
      return new Response("duplicate", { status: 200 });
    }
    if (isMissingTable(claimError)) {
      console.warn("Webhook MP: tabela mp_webhook_events ausente; rode docs/add-webhook-events.sql");
    } else {
      console.error("Webhook MP: falha ao registrar evento", claimError);
    }
  } else {
    claimed = true;
  }

  const values: Record<string, unknown> = {
    payment_status: paymentStatus,
    payment_method: methodLabel(payment),
    mp_payment_id: paymentId,
    paid_at: paymentStatus === "pago" ? new Date().toISOString() : null,
  };

  const { error } = await admin.from("appointments").update(values).eq("id", appointmentId);
  if (error) {
    if (isMissingColumn(error)) {
      console.warn("Webhook MP: colunas de pagamento ausentes; rode docs/add-payment-columns.sql");
    } else {
      console.error("Webhook MP: falha ao atualizar agendamento", error);
    }
    // libera o evento para que um reenvio possa tentar novamente
    if (claimed) {
      await admin.from("mp_webhook_events").delete().eq("event_id", eventId);
    }
  }

  return new Response("ok", { status: 200 });
}

/** Escolhe o pagamento mais relevante de uma merchant_order (Checkout Pro / cartão). */
function pickOrderPayment(payments: PaymentPayload[]) {
  const priority = ["approved", "authorized", "refunded", "charged_back", "in_process", "pending"];
  const sorted = [...payments].sort((a, b) => {
    const ia = priority.indexOf((a.status ?? "").toLowerCase());
    const ib = priority.indexOf((b.status ?? "").toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return sorted[0];
}

async function handleNotification(request: Request) {
  const url = new URL(request.url);
  const raw = (await request.json().catch(() => ({}))) as {
    id?: number | string;
    type?: string;
    topic?: string;
    action?: string;
    user_id?: number | string;
    data?: { id?: number | string };
    resource?: string;
  };

  const topic = raw.type ?? raw.topic ?? url.searchParams.get("topic") ?? url.searchParams.get("type") ?? "";
  const isOrder = topic.includes("merchant_order");
  if (topic && !topic.includes("payment") && !isOrder) {
    return new Response("ignored", { status: 200 });
  }

  // merchant_order pode chegar com o id em `resource` (URL completa).
  const resourceId = raw.resource ? String(raw.resource).split("/").filter(Boolean).pop() : null;
  const notificationId = String(
    raw.data?.id ?? resourceId ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
  ).trim();
  if (!notificationId) return new Response("no payment id", { status: 200 });

  const action = raw.action ?? url.searchParams.get("action") ?? topic ?? "payment";

  const supabaseUrl =
    process.env["SUPABASE_URL"] || process.env["SB_URL"] || process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["SB_SERVICE_ROLE_KEY"] ||
    process.env["SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceKey) {
    console.error("Webhook MP: credenciais do banco ausentes");
    return new Response("misconfigured", { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const collectorId = raw.user_id != null ? String(raw.user_id) : url.searchParams.get("user_id");
  const accessToken = await resolveAccessToken(admin, collectorId, isOrder ? "" : notificationId);
  if (!accessToken) {
    console.error("Webhook MP: conta não identificada para o pagamento", notificationId);
    return new Response("unknown account", { status: 200 });
  }

  if (isOrder) {
    const orderRes = await fetch(
      `https://api.mercadopago.com/merchant_orders/${encodeURIComponent(notificationId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const order = (await orderRes.json().catch(() => ({}))) as {
      external_reference?: string;
      payments?: PaymentPayload[];
    };
    if (!orderRes.ok) {
      console.error("Webhook MP: falha ao consultar merchant_order", orderRes.status, order);
      return new Response("order fetch failed", { status: 200 });
    }
    const chosen = pickOrderPayment(order.payments ?? []);
    if (!chosen?.id) return new Response("no payment in order", { status: 200 });

    // busca o pagamento completo para ter external_reference/metadata confiáveis
    const paymentId = String(chosen.id);
    const detail = await fetchPayment(accessToken, paymentId);
    const payment: PaymentPayload = detail.ok ? detail.payment : chosen;
    if (!payment.external_reference && order.external_reference) {
      payment.external_reference = order.external_reference;
    }
    return applyPayment(admin, payment, paymentId, `${paymentId}:${payment.status ?? action}`);
  }

  const { ok, status, payment } = await fetchPayment(accessToken, notificationId);
  if (!ok) {
    console.error("Webhook MP: falha ao consultar pagamento", status, payment);
    return new Response("payment fetch failed", { status: 200 });
  }

  const eventId = String(
    raw.id ?? url.searchParams.get("id_event") ?? `${notificationId}:${action}`,
  ).trim();

  return applyPayment(admin, payment, notificationId, eventId);
}


export const Route = createFileRoute("/api/public/mercadopago-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await handleNotification(request);
        } catch (error) {
          console.error("Webhook MP: erro inesperado", error);
          return new Response("error", { status: 200 });
        }
      },
      // O Mercado Pago valida a URL com GET em algumas configurações.
      GET: async ({ request }) => {
        try {
          return await handleNotification(request);
        } catch {
          return new Response("ok", { status: 200 });
        }
      },
    },
  },
});

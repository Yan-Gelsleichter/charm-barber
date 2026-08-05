import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import { mapPaymentStatus } from "./mercadopago-pix";

type Admin = ReturnType<typeof createClient>;

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

async function handleNotification(request: Request) {
  const url = new URL(request.url);
  const raw = (await request.json().catch(() => ({}))) as {
    type?: string;
    topic?: string;
    action?: string;
    user_id?: number | string;
    data?: { id?: number | string };
  };

  const topic = raw.type ?? raw.topic ?? url.searchParams.get("topic") ?? url.searchParams.get("type") ?? "";
  if (topic && !topic.includes("payment")) {
    return new Response("ignored", { status: 200 });
  }

  const paymentId = String(
    raw.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
  ).trim();
  if (!paymentId) return new Response("no payment id", { status: 200 });

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
  const accessToken = await resolveAccessToken(admin, collectorId, paymentId);
  if (!accessToken) {
    console.error("Webhook MP: conta não identificada para o pagamento", paymentId);
    return new Response("unknown account", { status: 200 });
  }

  const paymentResponse = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const payment = (await paymentResponse.json().catch(() => ({}))) as {
    id?: number | string;
    status?: string;
    status_detail?: string;
    payment_method_id?: string;
    external_reference?: string;
    metadata?: { appointment_id?: string };
  };
  if (!paymentResponse.ok) {
    console.error("Webhook MP: falha ao consultar pagamento", paymentResponse.status, payment);
    return new Response("payment fetch failed", { status: 200 });
  }

  const appointmentId = payment.external_reference || payment.metadata?.appointment_id;
  if (!appointmentId) return new Response("no appointment", { status: 200 });

  // aprovado -> pago | pendente | estornado (refunded/charged_back) | cancelado/expirado/falhou
  const paymentStatus = mapPaymentStatus(payment.status);
  const values: Record<string, unknown> = {
    payment_status: paymentStatus,
    payment_method: payment.payment_method_id ?? "pix",
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
  }

  return new Response("ok", { status: 200 });
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

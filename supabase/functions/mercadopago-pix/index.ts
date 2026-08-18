// Supabase Edge Function: mercadopago-pix
// Cria um pagamento PIX (ou consulta o status) usando o access_token do
// Mercado Pago da barbearia dona do agendamento (Mercado Pago Connect).

// deno-lint-ignore-file
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));

    // Usamos o admin (service_role) para buscar o agendamento e barbearia com segurança,
    // liberando a necessidade de token de usuário logado para clientes anônimos/convidados.
    const admin = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- consulta de status -------------------------------------------------
    if (body.action === "status") {
      const { payment_id, appointment_id } = body;
      if (!payment_id || !appointment_id) return json({ error: "payment_id/appointment_id required" }, 400);
      const ctx = await loadContext(admin, appointment_id);
      if ("error" in ctx) return json({ error: ctx.error }, ctx.status);
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
      });
      const pay = await res.json();
      if (!res.ok) return json({ error: pay.message ?? "falha ao consultar pagamento" }, 400);
      return json({ status: pay.status, status_detail: pay.status_detail });
    }

    // ---- criação do PIX -----------------------------------------------------
    const { appointment_id } = body;
    if (!appointment_id) return json({ error: "appointment_id required" }, 400);

    const ctx = await loadContext(admin, appointment_id);
    if ("error" in ctx) return json({ error: ctx.error }, ctx.status);

    const { appointment, service, accessToken } = ctx;
    const amount = Number(service?.price ?? 0);
    if (!(amount > 0)) return json({ error: "serviço sem preço definido" }, 400);

    const payerEmail =
      (appointment.email && String(appointment.email).trim()) ||
      "cliente@example.com";

    const res = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "X-Idempotency-Key": `${appointment_id}-${Date.now()}`,
      },
      body: JSON.stringify({
        transaction_amount: Number(amount.toFixed(2)),
        description: `${service?.name ?? "Serviço"} — agendamento`,
        payment_method_id: "pix",
        payer: {
          email: payerEmail,
          first_name: String(appointment.customer_name ?? "Cliente").split(" ")[0],
        },
      }),
    });
    const pay = await res.json();
    if (!res.ok) {
      return json({ error: pay.message ?? "falha ao criar pagamento PIX", details: pay }, 400);
    }

    const tx = pay.point_of_interaction?.transaction_data ?? {};
    return json({
      payment_id: pay.id,
      status: pay.status,
      amount,
      qr_code: tx.qr_code ?? null,
      qr_code_base64: tx.qr_code_base64 ?? null,
      ticket_url: tx.ticket_url ?? null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function loadContext(admin: any, appointmentId: string) {
  const { data: appointment, error } = await admin
    .from("appointments")
    .select("id, service_id, barbershop_id, customer_name, email")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!appointment) return { error: "agendamento não encontrado", status: 404 };
  if (!appointment.barbershop_id) return { error: "agendamento sem barbearia", status: 400 };

  const { data: shop } = await admin
    .from("barbershops")
    .select("id, mp_access_token")
    .eq("id", appointment.barbershop_id)
    .maybeSingle();
  if (!shop?.mp_access_token) {
    return { error: "Esta barbearia ainda não conectou o Mercado Pago", status: 400 };
  }

  const { data: service } = await admin
    .from("services")
    .select("id, name, price")
    .eq("id", appointment.service_id)
    .maybeSingle();

  return { appointment, service, accessToken: shop.mp_access_token as string };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

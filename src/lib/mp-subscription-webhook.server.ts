/**
 * Notificações de assinatura (Preapproval) do Mercado Pago:
 * `subscription_preapproval` (mudança de status da assinatura) e
 * `subscription_authorized_payment` (uma cobrança do ciclo foi processada).
 *
 * Reaproveita a resolução de tenant/assinatura HMAC e o `fetchPayment` já
 * usados pelo webhook de pagamento avulso (mp-webhook-handler.server.ts),
 * mas grava em tabelas próprias (client_subscriptions / subscription_charges)
 * em vez de em `appointments`.
 */
import { resolveTenant, verifySignature, fetchPayment } from "@/lib/mp-webhook-handler.server";
import type { PaymentPayload, RawNotification } from "@/lib/mp-webhook-handler.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

async function handlePreapprovalStatus(admin: Admin, accessToken: string, preapprovalId: string) {
  const res = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return new Response("preapproval fetch failed", { status: 200 });
  const body = (await res.json().catch(() => ({}))) as { status?: string };

  const { data: sub } = await admin
    .from("client_subscriptions")
    .select("id, status")
    .eq("mp_preapproval_id", preapprovalId)
    .maybeSingle();
  const subscription = sub as { id: string; status: string } | null;
  if (!subscription) {
    console.warn("Webhook assinatura: preapproval sem assinatura correspondente", { preapprovalId });
    return new Response("no subscription found", { status: 200 });
  }

  const mpStatus = (body.status ?? "").toLowerCase();
  // "authorized" é o mesmo status usado enquanto a assinatura já está ativa
  // e cobrando normalmente: nunca rebaixamos "active" de volta pra
  // "authorized" só por causa de um ping de status.
  let nextStatus: string | null = null;
  if (mpStatus === "cancelled") nextStatus = "cancelled";
  else if (mpStatus === "paused") nextStatus = "paused";
  else if (mpStatus === "pending" && subscription.status !== "active") nextStatus = "pending";
  else if (mpStatus === "authorized" && subscription.status !== "active") nextStatus = "authorized";

  if (!nextStatus || nextStatus === subscription.status) return new Response("ok", { status: 200 });

  const { error } = await admin.from("client_subscriptions").update({ status: nextStatus }).eq("id", subscription.id);
  if (error) {
    console.error("Webhook assinatura: falha ao atualizar status da assinatura", error);
    return new Response("update failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}

async function handleSubscriptionPayment(admin: Admin, accessToken: string, paymentId: string) {
  const { ok, payment } = await fetchPayment(accessToken, paymentId);
  if (!ok) return new Response("payment fetch failed", { status: 200 });

  // O `external_reference` da cobrança herda o que foi enviado na criação do
  // preapproval — lá usamos o id da nossa linha em client_subscriptions.
  const externalRef = String((payment as PaymentPayload).external_reference ?? "").trim();
  if (!externalRef) {
    console.warn("Webhook assinatura: cobrança sem external_reference", { paymentId });
    return new Response("no subscription reference", { status: 200 });
  }

  const { data: sub } = await admin
    .from("client_subscriptions")
    .select("id, status")
    .eq("id", externalRef)
    .maybeSingle();
  const subscription = sub as { id: string; status: string } | null;
  if (!subscription) {
    console.warn("Webhook assinatura: cobrança referencia assinatura inexistente", { paymentId, externalRef });
    return new Response("no subscription found", { status: 200 });
  }

  const paymentIdStr = String((payment as PaymentPayload).id ?? paymentId);
  const status = String((payment as PaymentPayload).status ?? "").toLowerCase();
  const isApproved = status === "approved" || status === "authorized";
  const paymentAny = payment as PaymentPayload & { transaction_amount?: number; date_approved?: string };

  const insert = await admin.from("subscription_charges").insert({
    subscription_id: subscription.id,
    mp_payment_id: paymentIdStr,
    amount: paymentAny.transaction_amount ?? null,
    status,
    paid_at: isApproved ? (paymentAny.date_approved ?? new Date().toISOString()) : null,
  });
  const isDuplicate =
    !!insert.error && (insert.error.code === "23505" || /duplicate key/i.test(insert.error.message ?? ""));
  if (insert.error && !isDuplicate) {
    console.error("Webhook assinatura: falha ao gravar cobrança", insert.error);
    return new Response("charge insert failed", { status: 500 });
  }
  if (isDuplicate) return new Response("already processed", { status: 200 });

  if (subscription.status === "cancelled") return new Response("ok", { status: 200 });

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { error } = await admin
    .from("client_subscriptions")
    .update({
      status: isApproved ? "active" : "payment_failed",
      current_period_start: isApproved ? periodStart.toISOString() : undefined,
      current_period_end: isApproved ? periodEnd.toISOString() : undefined,
    })
    .eq("id", subscription.id)
    .neq("status", "cancelled");
  if (error) {
    console.error("Webhook assinatura: falha ao atualizar assinatura após cobrança", error);
    return new Response("subscription update failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}

export async function handleSubscriptionNotification(
  admin: Admin,
  request: Request,
  url: URL,
  raw: RawNotification,
  topic: string,
): Promise<Response> {
  const notificationId = String(
    raw.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
  ).trim();
  if (!notificationId) return new Response("no id", { status: 200 });

  const collectorId = raw.user_id != null ? String(raw.user_id) : url.searchParams.get("user_id");
  const tenant = await resolveTenant(admin, collectorId, "", null);
  if (!tenant?.accessToken) return new Response("unknown account", { status: 200 });

  const signature = await verifySignature(request, url, notificationId, tenant.webhookSecret);
  if (signature === "invalid" || signature === "stale") return new Response("ok", { status: 200 });

  if (topic === "subscription_preapproval") {
    return handlePreapprovalStatus(admin, tenant.accessToken, notificationId);
  }
  return handleSubscriptionPayment(admin, tenant.accessToken, notificationId);
}

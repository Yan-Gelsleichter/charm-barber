/**
 * Notificação de pagamento de um PEDIDO DE PRODUTO — reconhecida dentro do
 * mesmo fluxo de `applyPayment` (mp-webhook-handler.server.ts) porque tanto
 * agendamento quanto produto usam os mesmos tópicos `payment`/`merchant_order`
 * do Mercado Pago (diferente de assinatura, que tem tópicos próprios). A
 * separação é pelo prefixo `"product:"` no external_reference.
 */

import { mapPaymentStatus } from "@/lib/mp-status.server";
import { decrementProductStockForItems } from "@/lib/product-stock.server";
import type { PaymentPayload } from "@/lib/mp-webhook-handler.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function methodLabel(payment: { payment_type_id?: string; payment_method_id?: string }) {
  const type = (payment.payment_type_id ?? "").toLowerCase();
  if (type === "credit_card") return "credit_card";
  if (type === "debit_card") return "debit_card";
  if (type === "bank_transfer" || payment.payment_method_id === "pix") return "pix";
  return payment.payment_method_id ?? type ?? "outro";
}

export function parseProductOrderId(externalReference: string | undefined | null): string | null {
  const ref = String(externalReference ?? "").trim();
  if (!ref.startsWith("product:")) return null;
  const orderId = ref.slice("product:".length).split(":")[0]?.trim();
  return orderId && UUID_RE.test(orderId) ? orderId : null;
}

export async function applyProductOrderPayment(
  admin: Admin,
  payment: PaymentPayload,
  paymentId: string,
  eventId: string,
): Promise<Response> {
  const orderId = parseProductOrderId(payment.external_reference);
  if (!orderId) return new Response("no order reference", { status: 200 });

  const { data: order } = await admin
    .from("product_orders")
    .select("id, barbershop_id, push_token, payment_status")
    .eq("id", orderId)
    .maybeSingle();
  const row = order as
    | { id: string; barbershop_id: string; push_token: string | null; payment_status: string }
    | null;
  if (!row) return new Response("no order found", { status: 200 });

  const paymentStatus = mapPaymentStatus(payment.status);
  const isApproved = paymentStatus === "pago" || payment.status === "approved";

  // Trava de idempotência: mesma tabela/chave já usada pro pagamento de
  // agendamento e de assinatura — event_id único por notificação do MP.
  const { error: claimError } = await admin.from("mp_webhook_events").insert({
    event_id: eventId,
    payment_id: paymentId,
    appointment_id: orderId,
    status: isApproved ? "pago" : paymentStatus,
  });
  const isDuplicate = !!claimError && (claimError.code === "23505" || /duplicate key/i.test(claimError.message ?? ""));
  if (isDuplicate) return new Response("already processed", { status: 200 });
  if (claimError) {
    console.error("[mp-product-webhook] falha ao reservar evento", claimError);
    return new Response("event claim failed", { status: 500 });
  }

  const values: Record<string, unknown> = {
    payment_status: isApproved ? "pago" : paymentStatus,
    payment_method: methodLabel(payment),
    mp_payment_id: paymentId,
    paid_at: isApproved ? new Date().toISOString() : null,
  };
  let updateQuery = admin.from("product_orders").update(values).eq("id", row.id);
  if (!isApproved) updateQuery = updateQuery.neq("payment_status", "pago");
  const { error: updateError } = await updateQuery;
  if (updateError) {
    console.error("[mp-product-webhook] falha ao atualizar pedido", updateError);
    return new Response("update failed", { status: 500 });
  }

  if (isApproved && row.payment_status !== "pago") {
    const { data: itemsData } = await admin
      .from("product_order_items")
      .select("product_id, product_title, quantity")
      .eq("order_id", row.id);
    const items = (itemsData ?? []) as { product_id: string; product_title: string; quantity: number }[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await decrementProductStockForItems(admin as any, items);

    try {
      const { sendPush } = await import("@/lib/push.server");
      const itemsLabel = items.map((i) => (i.quantity > 1 ? `${i.quantity}x ${i.product_title}` : i.product_title)).join(", ");

      const { data: admins } = await admin
        .from("barbers")
        .select("id")
        .eq("barbershop_id", row.barbershop_id)
        .eq("is_admin", true);
      const adminIds = ((admins ?? []) as { id: string }[]).map((b) => b.id);
      if (adminIds.length > 0) {
        const { data: subs } = await admin.from("push_subscriptions").select("token").in("barber_id", adminIds);
        const tokens = ((subs ?? []) as { token: string }[]).map((s) => s.token);
        if (tokens.length > 0) {
          const { invalidTokens } = await sendPush(tokens, {
            title: "Nova venda de produto",
            body: `Compra confirmada: ${itemsLabel || "produto"}`,
            url: "/painel?tab=produtos",
          });
          if (invalidTokens.length > 0) {
            await admin.from("push_subscriptions").delete().in("token", invalidTokens);
          }
        }
      }

      if (row.push_token) {
        await sendPush([row.push_token], {
          title: "Pronto para retirar!",
          body: `Seu pedido (${itemsLabel || "produto"}) já pode ser retirado na barbearia.`,
          url: "/meus-agendamentos",
        });
      }
    } catch (pushError) {
      console.warn("[mp-product-webhook] falha ao notificar", pushError);
    }
  }

  return new Response("ok", { status: 200 });
}

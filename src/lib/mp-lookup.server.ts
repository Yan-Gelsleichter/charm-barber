/**
 * Localiza o pagamento de um agendamento no Mercado Pago.
 *
 * O Checkout Pro guarda em `mp_payment_id` a referência da preferência
 * ("pref:<id>"), que NÃO é consultável em /v1/payments/<id>. Por isso a busca
 * segue vários caminhos: id do pagamento → merchant_orders da preferência →
 * external_reference (id do agendamento).
 */
export type MpPayment = { id?: number | string; status?: string; external_reference?: string };

export async function findMercadoPagoPayment(params: {
  token: string;
  appointmentId: string;
  storedRef?: string | null;
  preferenceId?: string | null;
  paymentId?: string | null;
  merchantOrderId?: string | null;
}): Promise<MpPayment | null> {
  const auth = { Authorization: `Bearer ${params.token}` };
  const stored = String(params.storedRef ?? "");
  const storedPreferenceId = stored.startsWith("pref:") ? stored.slice(5) : null;
  const preferenceId = params.preferenceId ?? storedPreferenceId;
  const paymentId = params.paymentId ?? (storedPreferenceId ? null : stored || null);

  let payment: MpPayment | null = null;

  if (paymentId) {
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      { headers: auth },
    );
    if (res.ok) payment = (await res.json().catch(() => null)) as MpPayment | null;
  }

  if (!payment?.status && params.merchantOrderId) {
    const res = await fetch(
      `https://api.mercadopago.com/merchant_orders/${encodeURIComponent(params.merchantOrderId)}`,
      { headers: auth },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { payments?: MpPayment[] };
      const list = body.payments ?? [];
      payment = list.find((p) => p.status === "approved") ?? list[0] ?? null;
    }
  }

  if (!payment?.status && preferenceId) {
    const res = await fetch(
      `https://api.mercadopago.com/merchant_orders/search?preference_id=${encodeURIComponent(preferenceId)}`,
      { headers: auth },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        elements?: Array<{ payments?: MpPayment[] }>;
        results?: Array<{ payments?: MpPayment[] }>;
      };
      const orders = body.elements ?? body.results ?? [];
      const all = orders.flatMap((o) => o.payments ?? []);
      payment = all.find((p) => p.status === "approved") ?? all[0] ?? null;
    }
  }

  if (!payment?.status) {
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(params.appointmentId)}`,
      { headers: auth },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { results?: MpPayment[] };
      const results = body.results ?? [];
      payment =
        results.find((p) => p.status === "approved") ??
        results.find((p) =>
          String(p.external_reference ?? "").startsWith(params.appointmentId),
        ) ??
        results[0] ??
        null;
    }
  }

  // Pagamento vindo da merchant_order traz só um resumo: busca o detalhe.
  if (payment?.id && payment.status !== "approved") {
    const res = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(payment.id))}`,
      { headers: auth },
    );
    if (res.ok) payment = ((await res.json().catch(() => payment)) as MpPayment) ?? payment;
  }

  return payment?.status ? payment : null;
}

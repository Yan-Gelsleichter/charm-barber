/**
 * Cria a Preferência de Pagamento (Checkout Pro) de um pedido de produto já
 * gravado em `product_orders`/`product_order_items`. Espelha o princípio já
 * usado em `mercadopago-preapproval.ts` (assinaturas): o dinheiro vai
 * sempre pra conta da própria barbearia — nunca lê `payout_mode`, nunca
 * consulta `barbers.mp_access_token`, nunca manda `marketplace_fee`. Cada
 * item do pedido vira seu próprio item na preferência (o Checkout Pro soma
 * sozinho), diferente do agendamento (que junta tudo num item só).
 */

import { mpNotificationUrl } from "@/lib/mp-webhook.server";
import { publicOrigin } from "@/lib/app-origin.server";
import { resolvePayerEmail } from "@/lib/mp-payer.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

export async function createProductOrderPreference(
  admin: Admin,
  opts: { orderId: string; requestUrl: string; payerEmailHint?: string | null },
): Promise<{ initPoint?: string; error?: string }> {
  const { data: order, error: orderError } = await admin
    .from("product_orders")
    .select("id, barbershop_id, customer_name, customer_email, total_price")
    .eq("id", opts.orderId)
    .maybeSingle();
  if (orderError || !order) return { error: "Pedido não encontrado." };
  const row = order as {
    id: string;
    barbershop_id: string;
    customer_name: string;
    customer_email: string | null;
    total_price: number;
  };

  const { data: items, error: itemsError } = await admin
    .from("product_order_items")
    .select("product_title, product_price, quantity")
    .eq("order_id", row.id);
  if (itemsError || !items || items.length === 0) return { error: "Itens do pedido não encontrados." };
  const orderItems = items as { product_title: string; product_price: number; quantity: number }[];

  const { data: shop, error: shopError } = await admin
    .from("barbershops")
    .select("mp_access_token")
    .eq("id", row.barbershop_id)
    .maybeSingle();
  if (shopError) return { error: "Não foi possível carregar a conta de pagamento." };

  // Só a conta da própria barbearia — nunca uma conta "coringa" da
  // plataforma, nunca a conta de um barbeiro. Mesmo princípio de
  // mercadopago-preapproval.ts.
  const shopToken = String((shop as { mp_access_token?: string | null } | null)?.mp_access_token ?? "").trim();
  if (!shopToken || shopToken.toUpperCase().startsWith("TEST-")) {
    return { error: "Esta barbearia ainda não conectou o Mercado Pago." };
  }

  const payerEmail = resolvePayerEmail(opts.payerEmailHint, row.customer_email);
  if (!payerEmail) return { error: "Informe um e-mail válido para continuar o pagamento." };

  const origin = publicOrigin(opts.requestUrl);
  const backUrl = `${origin}/pedido-confirmado/${row.id}`;
  const attemptId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const externalReference = `product:${row.id}:${attemptId}`;

  const preferenceBody: Record<string, unknown> = {
    items: orderItems.map((item) => ({
      title: item.product_title,
      description: "Produto da barbearia",
      quantity: item.quantity,
      currency_id: "BRL",
      unit_price: Number(item.product_price.toFixed(2)),
    })),
    payer: {
      email: payerEmail,
      name: String(row.customer_name ?? "Cliente").split(" ")[0],
    },
    external_reference: externalReference,
    notification_url: mpNotificationUrl(opts.requestUrl),
    back_urls: {
      success: `${backUrl}?status=success`,
      pending: `${backUrl}?status=pending`,
      failure: `${backUrl}?status=failure`,
    },
    auto_return: "approved",
    payment_methods: {
      excluded_payment_methods: [],
      excluded_payment_types: [],
      installments: 12,
      default_installments: 1,
    },
    binary_mode: false,
    statement_descriptor: "BARBEARIA",
    metadata: { product_order_id: row.id },
  };

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${shopToken}`,
      accept: "application/json",
      "content-type": "application/json",
      "cache-control": "no-cache",
      "X-Idempotency-Key": `product-pref-${externalReference}`,
    },
    body: JSON.stringify(preferenceBody),
  });

  const rawBody = await res.text().catch(() => "");
  let parsed: { init_point?: string; message?: string; error?: string } = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok || !parsed.init_point) {
    console.error("[mp-product-preference] falha ao criar preferência", { status: res.status, body: rawBody });
    return { error: parsed.message ?? parsed.error ?? "Não foi possível iniciar o pagamento online." };
  }

  return { initPoint: parsed.init_point };
}

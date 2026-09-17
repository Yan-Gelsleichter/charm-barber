import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { createProductOrderPreference } from "@/lib/mp-product-preference.server";

/**
 * Criação pública de um pedido de produto (carrinho com um ou mais
 * produtos, cada um com sua própria quantidade) + preferência de
 * pagamento do Mercado Pago, num único endpoint — diferente do
 * agendamento, aqui não existe opção de pagar presencialmente, então não
 * há necessidade de separar "criar pedido" de "criar preferência" em duas
 * telas. Nunca reserva estoque aqui — só valida que há estoque suficiente
 * no momento da compra; o desconto de verdade só acontece quando o
 * pagamento é confirmado (ver src/lib/product-stock.server.ts).
 */

const requestSchema = z.object({
  barbershop_id: z.string().uuid(),
  customer_name: z.string().min(2),
  customer_phone: z.string().regex(/^\d{8,15}$/),
  customer_email: z.string().email().nullable().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

export const Route = createFileRoute("/api/public/product-order-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados do pedido inválidos." }, 400);
          const d = parsed.data;

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const productIds = Array.from(new Set(d.items.map((i) => i.product_id)));
          const { data: productsData, error: productsError } = await admin
            .from("products")
            .select("id, title, price, stock_quantity, active, barbershop_id")
            .in("id", productIds);
          if (productsError) return json({ error: "Não foi possível carregar os produtos." }, 500);
          const products = (productsData ?? []) as {
            id: string;
            title: string;
            price: number;
            stock_quantity: number;
            active: boolean;
            barbershop_id: string;
          }[];
          const productById = new Map(products.map((p) => [p.id, p]));

          for (const item of d.items) {
            const product = productById.get(item.product_id);
            if (!product || product.barbershop_id !== d.barbershop_id || !product.active) {
              return json({ error: "Um dos produtos não está mais disponível." }, 400);
            }
            if (product.stock_quantity < item.quantity) {
              return json({ error: `Estoque insuficiente para "${product.title}".` }, 400);
            }
          }

          const totalPrice = d.items.reduce((sum, item) => {
            const product = productById.get(item.product_id)!;
            return sum + Number(product.price) * item.quantity;
          }, 0);

          const inserted = await admin
            .from("product_orders")
            .insert({
              barbershop_id: d.barbershop_id,
              customer_name: d.customer_name.trim(),
              customer_phone: d.customer_phone,
              customer_email: d.customer_email?.trim().toLowerCase() ?? null,
              total_price: Number(totalPrice.toFixed(2)),
              payment_status: "pendente",
              is_walk_in: false,
            })
            .select("id")
            .maybeSingle();
          if (inserted.error || !inserted.data) {
            console.error("[product-order-create] falha ao criar pedido", inserted.error);
            return json({ error: "Não foi possível criar o pedido." }, 500);
          }
          const orderId = (inserted.data as { id: string }).id;

          const itemRows = d.items.map((item) => {
            const product = productById.get(item.product_id)!;
            return {
              order_id: orderId,
              product_id: product.id,
              product_title: product.title,
              product_price: Number(product.price),
              quantity: item.quantity,
            };
          });
          const itemsInsert = await admin.from("product_order_items").insert(itemRows);
          if (itemsInsert.error) {
            console.error("[product-order-create] falha ao criar itens", itemsInsert.error);
            return json({ error: "Não foi possível criar os itens do pedido." }, 500);
          }

          const preference = await createProductOrderPreference(admin, {
            orderId,
            requestUrl: request.url,
            payerEmailHint: d.customer_email ?? null,
          });
          if (!preference.initPoint) {
            return json({ error: preference.error ?? "Não foi possível iniciar o pagamento." }, 400);
          }

          return json({ id: orderId, init_point: preference.initPoint });
        } catch (error) {
          console.error("[product-order-create] erro inesperado", error);
          return json({ error: "Erro inesperado ao criar o pedido." }, 500);
        }
      },
    },
  },
});

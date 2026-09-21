import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { computeLoyaltyStatus } from "@/lib/loyalty.server";
import { decrementProductStock } from "@/lib/product-stock.server";

/**
 * Troca um resgate de fidelidade disponível por um produto do catálogo
 * (retirada na barbearia). Nasce como um pedido já "pago" (forma de
 * pagamento: fidelidade) com valor zero — cai na fila "Pedidos aguardando
 * retirada" do admin como qualquer outro pedido. Tudo é revalidado aqui no
 * servidor (resgate disponível, produto realmente é prêmio do programa,
 * estoque) — nunca confia no que o cliente mandou.
 *
 * Diferente do resgate de atendimento, esse é consumido de vez: não volta
 * sozinho se o pedido for cancelado (o admin resolve manualmente).
 */

const requestSchema = z.object({
  barbershop_id: z.string().uuid(),
  program_id: z.string().uuid(),
  product_id: z.string().uuid(),
  customer_name: z.string().trim().min(2),
  customer_phone: z.string().regex(/^\d{8,15}$/),
  customer_email: z.string().email().nullable().optional(),
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

export const Route = createFileRoute("/api/public/loyalty-redeem-product")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);
          const d = parsed.data;

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const statuses = await computeLoyaltyStatus(admin, {
            barbershopId: d.barbershop_id,
            phone: d.customer_phone,
          });
          const match = statuses.find((s) => s.program.id === d.program_id);
          if (!match || match.availableNow < 1) {
            return json({ error: "Você não tem resgate disponível nesse programa." }, 400);
          }
          const product = match.rewardProducts.find((p) => p.id === d.product_id);
          if (!product) return json({ error: "Esse produto não faz parte do prêmio desse programa." }, 400);
          if (product.stock_quantity < 1) return json({ error: `"${product.title}" está esgotado no momento.` }, 400);

          const { data: productRow } = await admin
            .from("products")
            .select("id, title, price")
            .eq("id", product.id)
            .maybeSingle();
          const productInfo = productRow as { id: string; title: string; price: number } | null;
          if (!productInfo) return json({ error: "Produto não encontrado." }, 404);

          const now = new Date().toISOString();
          const inserted = await admin
            .from("product_orders")
            .insert({
              barbershop_id: d.barbershop_id,
              customer_name: d.customer_name,
              customer_phone: d.customer_phone,
              customer_email: d.customer_email?.trim().toLowerCase() ?? null,
              total_price: 0,
              payment_status: "pago",
              payment_method: "fidelidade",
              paid_at: now,
              is_walk_in: false,
              covered_by_loyalty_program_id: d.program_id,
            })
            .select("id")
            .maybeSingle();
          if (inserted.error || !inserted.data) {
            console.error("[loyalty-redeem-product] falha ao criar pedido", inserted.error);
            return json({ error: "Não foi possível registrar o resgate." }, 500);
          }
          const orderId = (inserted.data as { id: string }).id;

          const itemInsert = await admin.from("product_order_items").insert({
            order_id: orderId,
            product_id: productInfo.id,
            product_title: productInfo.title,
            // Prêmio: valor zero no pedido (o preço normal do produto só existe no catálogo).
            product_price: 0,
            quantity: 1,
          });
          if (itemInsert.error) {
            console.error("[loyalty-redeem-product] falha ao criar item", itemInsert.error);
            await admin.from("product_orders").delete().eq("id", orderId);
            return json({ error: "Não foi possível registrar o resgate." }, 500);
          }

          const redemption = await admin.from("loyalty_redemptions").insert({
            program_id: d.program_id,
            barbershop_id: d.barbershop_id,
            customer_phone: d.customer_phone,
            appointment_id: null,
            product_order_id: orderId,
          });
          if (redemption.error) {
            console.error("[loyalty-redeem-product] falha ao gravar resgate", redemption.error);
            await admin.from("product_orders").delete().eq("id", orderId);
            return json({ error: "Não foi possível registrar o resgate." }, 500);
          }

          await decrementProductStock(admin, productInfo.id, 1);

          try {
            const { data: admins } = await admin
              .from("barbers")
              .select("id")
              .eq("barbershop_id", d.barbershop_id)
              .eq("is_admin", true);
            const adminIds = ((admins ?? []) as { id: string }[]).map((b) => b.id);
            if (adminIds.length > 0) {
              const { data: subs } = await admin.from("push_subscriptions").select("token").in("barber_id", adminIds);
              const tokens = ((subs ?? []) as { token: string }[]).map((s) => s.token);
              if (tokens.length > 0) {
                const { sendPush } = await import("@/lib/push.server");
                const { invalidTokens } = await sendPush(tokens, {
                  title: "Prêmio de fidelidade resgatado",
                  body: `${d.customer_name} trocou o resgate por: ${productInfo.title}`,
                  url: "/painel?tab=produtos",
                });
                if (invalidTokens.length > 0) {
                  await admin.from("push_subscriptions").delete().in("token", invalidTokens);
                }
              }
            }
          } catch (pushError) {
            console.warn("[loyalty-redeem-product] falha ao notificar", pushError);
          }

          return json({ ok: true, order_id: orderId, product_title: productInfo.title });
        } catch (error) {
          console.error("[loyalty-redeem-product] erro inesperado", error);
          return json({ error: "Erro inesperado ao resgatar o prêmio." }, 500);
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { decrementProductStock } from "@/lib/product-stock.server";

/**
 * O cliente desfaz a troca de um resgate de fidelidade por um produto
 * (ex.: se arrependeu e prefere o corte grátis). Só vale enquanto o
 * pedido ainda não foi entregue: cancela o pedido, devolve o estoque e
 * apaga a linha de resgate — o resgate volta a ficar disponível na hora.
 * Autorizado por telefone batendo com o pedido (mesmo padrão de
 * product-order-push-token.ts).
 */

const requestSchema = z.object({
  order_id: z.string().uuid(),
  customer_phone: z.string().regex(/^\d{8,15}$/),
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

export const Route = createFileRoute("/api/public/loyalty-cancel-product-redemption")({
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

          const { data: found } = await admin
            .from("product_orders")
            .select("id, barbershop_id, customer_name, covered_by_loyalty_program_id")
            .eq("id", d.order_id)
            .eq("customer_phone", d.customer_phone)
            .maybeSingle();
          const order = found as
            | { id: string; barbershop_id: string; customer_name: string; covered_by_loyalty_program_id: string | null }
            | null;
          if (!order || !order.covered_by_loyalty_program_id) {
            return json({ error: "Pedido não encontrado." }, 404);
          }

          // Trava: só cancela se ainda está pago e não foi entregue — evita
          // cancelar duas vezes ou depois de o cliente já ter retirado.
          const cancelled = await admin
            .from("product_orders")
            .update({ payment_status: "cancelado" })
            .eq("id", order.id)
            .eq("payment_status", "pago")
            .is("fulfilled_at", null)
            .select("id")
            .maybeSingle();
          if (cancelled.error) {
            console.error("[loyalty-cancel-product-redemption] falha ao cancelar", cancelled.error);
            return json({ error: "Não foi possível cancelar o resgate." }, 500);
          }
          if (!cancelled.data) {
            return json({ error: "Esse pedido já foi entregue ou cancelado." }, 400);
          }

          const { data: itemsData } = await admin
            .from("product_order_items")
            .select("product_id, quantity")
            .eq("order_id", order.id);
          for (const item of (itemsData ?? []) as { product_id: string; quantity: number }[]) {
            // Quantidade negativa devolve o estoque (a função soma quando p_qty < 0).
            await decrementProductStock(admin, item.product_id, -item.quantity);
          }

          const { error: redemptionError } = await admin
            .from("loyalty_redemptions")
            .delete()
            .eq("product_order_id", order.id);
          if (redemptionError) {
            console.error("[loyalty-cancel-product-redemption] falha ao devolver resgate", redemptionError);
            return json({ error: "Pedido cancelado, mas não foi possível devolver o resgate. Fale com a barbearia." }, 500);
          }

          try {
            const { data: admins } = await admin
              .from("barbers")
              .select("id")
              .eq("barbershop_id", order.barbershop_id)
              .eq("is_admin", true);
            const adminIds = ((admins ?? []) as { id: string }[]).map((b) => b.id);
            if (adminIds.length > 0) {
              const { data: subs } = await admin.from("push_subscriptions").select("token").in("barber_id", adminIds);
              const tokens = ((subs ?? []) as { token: string }[]).map((s) => s.token);
              if (tokens.length > 0) {
                const { sendPush } = await import("@/lib/push.server");
                const { invalidTokens } = await sendPush(tokens, {
                  title: "Resgate de prêmio cancelado",
                  body: `${order.customer_name} desistiu do produto — não precisa separar.`,
                  url: "/painel?tab=produtos",
                });
                if (invalidTokens.length > 0) {
                  await admin.from("push_subscriptions").delete().in("token", invalidTokens);
                }
              }
            }
          } catch (pushError) {
            console.warn("[loyalty-cancel-product-redemption] falha ao notificar", pushError);
          }

          return json({ ok: true });
        } catch (error) {
          console.error("[loyalty-cancel-product-redemption] erro inesperado", error);
          return json({ error: "Erro inesperado ao cancelar o resgate." }, 500);
        }
      },
    },
  },
});

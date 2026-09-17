import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { decrementProductStockForItems } from "@/lib/product-stock.server";

/**
 * Venda de produto presencial, lançada pelo admin no balcão — mesmo
 * conceito do atendimento avulso (caixa-walkin-create.ts), mas pra
 * produtos: pode ter vários produtos numa venda só, cada um com sua
 * quantidade, e é atribuída a um barbeiro (pra comissão — nunca a
 * barbeiro nenhum quando a compra vem do próprio app do cliente).
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  items: z
    .array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1),
  customer_name: z.string().trim().min(1).max(120),
  customer_phone: z.string().optional(),
  payment_status: z.enum(["pago", "pendente"]).optional(),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-product-sale-create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);
          const d = parsed.data;

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "É preciso estar logado." }, 401);
          }
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: adminBarber } = await admin
            .from("barbers")
            .select("barbershop_id")
            .eq("user_id", user.id)
            .eq("is_admin", true)
            .maybeSingle();
          const barbershopId = (adminBarber as { barbershop_id?: string } | null)?.barbershop_id;
          if (!barbershopId) {
            return json({ error: "Só o administrador da barbearia pode fazer isso." }, 403);
          }

          const { data: targetBarber } = await admin
            .from("barbers")
            .select("id, barbershop_id")
            .eq("id", d.barber_id)
            .maybeSingle();
          if (!targetBarber || (targetBarber as { barbershop_id?: string | null }).barbershop_id !== barbershopId) {
            return json({ error: "Barbeiro não pertence a essa barbearia." }, 400);
          }

          const productIds = Array.from(new Set(d.items.map((i) => i.product_id)));
          const { data: productsData } = await admin
            .from("products")
            .select("id, title, price, barbershop_id")
            .in("id", productIds);
          const products = (productsData ?? []) as {
            id: string;
            title: string;
            price: number;
            barbershop_id: string;
          }[];
          const productById = new Map(products.map((p) => [p.id, p]));
          for (const item of d.items) {
            const product = productById.get(item.product_id);
            if (!product || product.barbershop_id !== barbershopId) {
              return json({ error: "Um dos produtos não pertence a essa barbearia." }, 400);
            }
          }

          const totalPrice = d.items.reduce(
            (sum, item) => sum + Number(productById.get(item.product_id)!.price) * item.quantity,
            0,
          );
          const paymentStatus = d.payment_status ?? "pago";
          const paid = paymentStatus === "pago";

          const inserted = await admin
            .from("product_orders")
            .insert({
              barbershop_id: barbershopId,
              customer_name: d.customer_name,
              customer_phone: d.customer_phone?.trim() || null,
              total_price: Number(totalPrice.toFixed(2)),
              payment_status: paymentStatus,
              payment_method: paid ? "presencial" : null,
              paid_at: paid ? new Date().toISOString() : null,
              is_walk_in: true,
              barber_id: d.barber_id,
            })
            .select("*")
            .maybeSingle();
          if (inserted.error || !inserted.data) {
            console.error("[caixa-product-sale-create] falha ao inserir pedido", inserted.error);
            return json({ error: "Não foi possível registrar a venda." }, 500);
          }
          const order = inserted.data as { id: string };

          const itemRows = d.items.map((item) => {
            const product = productById.get(item.product_id)!;
            return {
              order_id: order.id,
              product_id: product.id,
              product_title: product.title,
              product_price: Number(product.price),
              quantity: item.quantity,
            };
          });
          const itemsInsert = await admin.from("product_order_items").insert(itemRows);
          if (itemsInsert.error) {
            console.error("[caixa-product-sale-create] falha ao inserir itens", itemsInsert.error);
            return json({ error: "Não foi possível registrar os itens da venda." }, 500);
          }

          if (paid) {
            await decrementProductStockForItems(admin, d.items);
          }

          return json({ ok: true, order });
        } catch (error) {
          console.error("[caixa-product-sale-create] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

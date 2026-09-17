import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Grava o token de notificação push no pedido de produto — mesmo padrão
 * de appointment-push-token.ts (token capturado à parte da criação do
 * pedido, autorizado por telefone batendo com o pedido).
 */

const requestSchema = z.object({
  order_id: z.string().uuid(),
  customer_phone: z.string().regex(/^\d{8,15}$/),
  push_token: z.string().min(10),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

export const Route = createFileRoute("/api/public/product-order-push-token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const { error } = await admin
            .from("product_orders")
            .update({ push_token: parsed.data.push_token })
            .eq("id", parsed.data.order_id)
            .eq("customer_phone", parsed.data.customer_phone);
          if (error) {
            console.error("[product-order-push-token] falha ao gravar", error);
            return json({ error: "Não foi possível salvar." }, 500);
          }

          return json({ ok: true });
        } catch (error) {
          console.error("[product-order-push-token] erro inesperado", error);
          return json({ error: "Não foi possível salvar." }, 500);
        }
      },
    },
  },
});

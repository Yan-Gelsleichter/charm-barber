import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Marca um pedido de produto como "Entregue" (retirado na barbearia) —
 * ação manual do admin, na aba Produtos. O cliente já foi avisado que o
 * pedido está pronto no momento em que o pagamento foi confirmado (ver
 * mp-product-webhook.server.ts), então aqui só grava fulfilled_at, sem
 * reenviar push.
 */

const requestSchema = z.object({ order_id: z.string().uuid() });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/product-order-fulfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

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

          const found = await admin
            .from("product_orders")
            .select("id, barbershop_id")
            .eq("id", parsed.data.order_id)
            .maybeSingle();
          const row = found.data as { id: string; barbershop_id?: string | null } | null;
          if (found.error || !row) return json({ error: "Pedido não encontrado." }, 404);
          if (row.barbershop_id !== barbershopId) {
            return json({ error: "Esse pedido não é dessa barbearia." }, 403);
          }

          const { error } = await admin
            .from("product_orders")
            .update({ fulfilled_at: new Date().toISOString() })
            .eq("id", row.id);
          if (error) {
            console.error("[product-order-fulfill] falha ao marcar entregue", error);
            return json({ error: "Não foi possível marcar como entregue." }, 500);
          }

          return json({ ok: true });
        } catch (error) {
          console.error("[product-order-fulfill] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

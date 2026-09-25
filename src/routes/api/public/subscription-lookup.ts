import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Consulta (pelo painel, qualquer barbeiro logado) se um cliente — achado por
 * telefone ou e-mail — tem assinatura ativa na barbearia do barbeiro, e o
 * que cada plano cobre. A barbearia vem sempre do barbeiro logado, nunca do
 * corpo da requisição.
 */

const requestSchema = z.object({
  phone: z.string().regex(/^\d{8,15}$/).optional(),
  email: z.string().email().optional(),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/subscription-lookup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) return json({ error: "É preciso estar logado." }, 401);
          const { data: userData, error: authError } = await admin.auth.getUser(
            authorization.slice("Bearer ".length).trim(),
          );
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: callerBarber } = await admin
            .from("barbers")
            .select("barbershop_id")
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle();
          const barbershopId = (callerBarber as { barbershop_id?: string | null } | null)?.barbershop_id;
          if (!barbershopId) return json({ error: "Só barbeiros da barbearia podem consultar." }, 403);

          const { listActiveSubscriptionsForCustomer } = await import("@/lib/subscription.server");
          const subscriptions = await listActiveSubscriptionsForCustomer(admin, {
            barbershopId,
            phone: parsed.data.phone ?? null,
            email: parsed.data.email ?? null,
          });
          return json({ subscriptions });
        } catch (error) {
          console.error("[subscription-lookup] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

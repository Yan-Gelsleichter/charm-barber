import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { createPlatformPreapproval, cancelPlatformPreapproval } from "@/lib/platform-subscription.server";

/**
 * O ADMIN da barbearia assinando o próprio app (SaaS) — cria a primeira
 * cobrança recorrente da barbearia com a plataforma. Sempre deriva a
 * barbearia do bearer token (nunca aceita barbershop_id do corpo), pra
 * nenhum admin apontar pra barbearia errada.
 */

const requestSchema = z.object({
  plan: z.enum(["monthly", "yearly"]),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export const Route = createFileRoute("/api/public/platform-subscription-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Plano inválido." }, 400);

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
            return json({ error: "Só o administrador da barbearia pode assinar." }, 403);
          }

          const { data: shop } = await admin
            .from("barbershops")
            .select("subscription_status, subscription_id")
            .eq("id", barbershopId)
            .maybeSingle();
          const shopRow = shop as
            | { subscription_status?: string | null; subscription_id?: string | null }
            | null;

          if (shopRow?.subscription_status === "active") {
            return json({ error: "A assinatura já está ativa." }, 409);
          }

          // Reassinando depois de past_due/canceled: cancela a preapproval
          // antiga (que já cobra de verdade) antes de criar outra, senão
          // ficam duas cobrando em paralelo. Uma preapproval "trial" nunca
          // autorizada não cobra ninguém — não precisa cancelar, só sobrescreve.
          if (
            shopRow?.subscription_id &&
            (shopRow.subscription_status === "past_due" || shopRow.subscription_status === "canceled")
          ) {
            await cancelPlatformPreapproval(shopRow.subscription_id);
          }

          const payerEmail = (user.email ?? "").trim().toLowerCase();
          if (!payerEmail) {
            return json({ error: "Sua conta precisa ter um e-mail para assinar." }, 400);
          }

          const result = await createPlatformPreapproval({
            barbershopId,
            plan: parsed.data.plan,
            payerEmail,
            requestUrl: request.url,
          });
          if (!result.ok) return json({ error: result.error }, 400);

          const { error: updateError } = await admin
            .from("barbershops")
            .update({
              subscription_id: result.preapprovalId,
              subscription_plan: parsed.data.plan,
              mp_payer_email: payerEmail,
            })
            .eq("id", barbershopId);
          if (updateError) {
            console.error("Assinatura da plataforma: falha ao gravar subscription_id", updateError);
            return json({ error: "Não foi possível registrar a assinatura." }, 500);
          }

          return json({ init_point: result.initPoint });
        } catch (error) {
          console.error("Assinatura da plataforma: erro inesperado ao criar", error);
          return json({ error: "Não foi possível iniciar a assinatura." }, 500);
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { createPlatformPreapproval, type PlatformPlan } from "@/lib/platform-subscription.server";

/**
 * Desfaz um cancelamento agendado (cancel_at_period_end=true) enquanto o
 * período atual ainda não terminou. A preapproval antiga já foi cancelada
 * de verdade no Mercado Pago no momento do cancelamento — não existe nada
 * pra "descancelar" lá, então isso cria uma assinatura nova do zero, no
 * mesmo plano de antes. O acesso nunca foi interrompido (subscription_status
 * segue "active" o tempo todo).
 */

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

export const Route = createFileRoute("/api/public/platform-subscription-reactivate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
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
            return json({ error: "Só o administrador da barbearia pode reativar a assinatura." }, 403);
          }

          const { data: shop } = await admin
            .from("barbershops")
            .select("subscription_status, subscription_plan, cancel_at_period_end")
            .eq("id", barbershopId)
            .maybeSingle();
          const shopRow = shop as
            | {
                subscription_status?: string | null;
                subscription_plan?: string | null;
                cancel_at_period_end?: boolean | null;
              }
            | null;

          if (shopRow?.cancel_at_period_end !== true) {
            return json({ error: "Não há cancelamento agendado para desfazer." }, 409);
          }
          if (shopRow?.subscription_status !== "active") {
            return json({ error: "O período já terminou. Assine novamente para continuar." }, 409);
          }
          const plan = shopRow.subscription_plan as PlatformPlan | null;
          if (plan !== "monthly" && plan !== "yearly") {
            return json({ error: "Não foi possível identificar o plano anterior." }, 500);
          }

          const payerEmail = (user.email ?? "").trim().toLowerCase();
          if (!payerEmail) {
            return json({ error: "Sua conta precisa ter um e-mail para reativar." }, 400);
          }

          const result = await createPlatformPreapproval({
            barbershopId,
            plan,
            payerEmail,
            requestUrl: request.url,
          });
          if (!result.ok) return json({ error: result.error }, 400);

          const { error: updateError } = await admin
            .from("barbershops")
            .update({ subscription_id: result.preapprovalId, cancel_at_period_end: false })
            .eq("id", barbershopId);
          if (updateError) {
            console.error("Reativar assinatura da plataforma: falha ao gravar", updateError);
            return json({ error: "Não foi possível registrar a reativação." }, 500);
          }

          return json({ init_point: result.initPoint });
        } catch (error) {
          console.error("Reativar assinatura da plataforma: erro inesperado", error);
          return json({ error: "Não foi possível reativar a assinatura." }, 500);
        }
      },
    },
  },
});

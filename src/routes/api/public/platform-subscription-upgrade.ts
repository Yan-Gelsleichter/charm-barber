import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Agenda o upgrade mensal → anual: SEM chamar o Mercado Pago agora, só grava
 * a intenção (pending_plan_change). A troca de verdade (cancelar a mensal,
 * criar a anual) acontece depois, quando current_period_ends_at chegar, via
 * api/cron/process-plan-changes.ts.
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

export const Route = createFileRoute("/api/public/platform-subscription-upgrade")({
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
            return json({ error: "Só o administrador da barbearia pode alterar o plano." }, 403);
          }

          const { data: shop } = await admin
            .from("barbershops")
            .select("subscription_status, subscription_plan, pending_plan_change, current_period_ends_at")
            .eq("id", barbershopId)
            .maybeSingle();
          const shopRow = shop as
            | {
                subscription_status?: string | null;
                subscription_plan?: string | null;
                pending_plan_change?: string | null;
                current_period_ends_at?: string | null;
              }
            | null;

          if (shopRow?.pending_plan_change === "yearly") {
            return json({ ok: true, already_scheduled: true, effective_at: shopRow.current_period_ends_at });
          }
          if (shopRow?.subscription_status !== "active") {
            return json({ error: "Sua assinatura precisa estar ativa para fazer upgrade." }, 409);
          }
          if (shopRow?.subscription_plan !== "monthly") {
            return json({ error: "Você já está no plano anual." }, 409);
          }

          const { error: updateError } = await admin
            .from("barbershops")
            .update({ pending_plan_change: "yearly" })
            .eq("id", barbershopId);
          if (updateError) {
            console.error("Upgrade de assinatura: falha ao agendar", updateError);
            return json({ error: "Não foi possível agendar o upgrade." }, 500);
          }

          return json({ ok: true, effective_at: shopRow.current_period_ends_at });
        } catch (error) {
          console.error("Upgrade de assinatura: erro inesperado", error);
          return json({ error: "Não foi possível agendar o upgrade." }, 500);
        }
      },
    },
  },
});

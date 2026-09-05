import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { cancelPlatformPreapproval } from "@/lib/platform-subscription.server";

/**
 * O ADMIN cancela a própria assinatura da plataforma. Diferente do uso
 * best-effort desse mesmo cancelPlatformPreapproval em outros fluxos, aqui
 * o resultado importa de verdade: é a única ação cujo propósito inteiro é
 * garantir que não cobre mais — se falhar, não marca nada localmente.
 *
 * O acesso continua normal até current_period_ends_at: só grava a intenção
 * (cancel_at_period_end), quem efetiva o bloqueio na data certa é o cron
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

export const Route = createFileRoute("/api/public/platform-subscription-cancel")({
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
            return json({ error: "Só o administrador da barbearia pode cancelar a assinatura." }, 403);
          }

          const { data: shop } = await admin
            .from("barbershops")
            .select("subscription_status, subscription_id, cancel_at_period_end, current_period_ends_at")
            .eq("id", barbershopId)
            .maybeSingle();
          const shopRow = shop as
            | {
                subscription_status?: string | null;
                subscription_id?: string | null;
                cancel_at_period_end?: boolean | null;
                current_period_ends_at?: string | null;
              }
            | null;

          if (shopRow?.cancel_at_period_end === true) {
            return json({ ok: true, already_scheduled: true, effective_at: shopRow.current_period_ends_at });
          }
          if (shopRow?.subscription_status !== "active") {
            return json({ error: "Sua assinatura não está ativa." }, 409);
          }

          const canceled = shopRow.subscription_id
            ? await cancelPlatformPreapproval(shopRow.subscription_id)
            : false;
          if (!canceled) {
            return json(
              { error: "Não foi possível cancelar no Mercado Pago agora. Tente novamente." },
              502,
            );
          }

          const { error: updateError } = await admin
            .from("barbershops")
            .update({ cancel_at_period_end: true, pending_plan_change: null })
            .eq("id", barbershopId);
          if (updateError) {
            console.error("Cancelar assinatura da plataforma: falha ao gravar", updateError);
            return json({ error: "Cancelado no Mercado Pago, mas não foi possível registrar aqui." }, 500);
          }

          return json({ ok: true, effective_at: shopRow.current_period_ends_at });
        } catch (error) {
          console.error("Cancelar assinatura da plataforma: erro inesperado", error);
          return json({ error: "Não foi possível cancelar a assinatura." }, 500);
        }
      },
    },
  },
});

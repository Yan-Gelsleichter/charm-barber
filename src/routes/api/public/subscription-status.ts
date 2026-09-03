import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Diz o status da assinatura da barbearia (trial/active/past_due/canceled) e
 * quando o teste grátis termina — sem expor nenhum token. Usado pelo painel
 * admin/barbeiro pra decidir se bloqueia o acesso; o navegador nunca lê a
 * tabela barbershops diretamente (mp_access_token não pode vazar por ali).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export const Route = createFileRoute("/api/public/subscription-status")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const barbershopId = url.searchParams.get("barbershop_id");
          if (!barbershopId) return json({ error: "Barbearia não informada." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const { data: shop } = await admin
            .from("barbershops")
            .select("subscription_status, trial_ends_at, current_period_ends_at")
            .eq("id", barbershopId)
            .maybeSingle();
          const row = shop as {
            subscription_status?: string | null;
            trial_ends_at?: string | null;
            current_period_ends_at?: string | null;
          } | null;

          return json({
            subscription_status: row?.subscription_status ?? "trial",
            trial_ends_at: row?.trial_ends_at ?? null,
            current_period_ends_at: row?.current_period_ends_at ?? null,
          });
        } catch (error) {
          console.error("[subscription-status] erro inesperado", error);
          return json({ error: "Não foi possível verificar a assinatura." }, 500);
        }
      },
    },
  },
});

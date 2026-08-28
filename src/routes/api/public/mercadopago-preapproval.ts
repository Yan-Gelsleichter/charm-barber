import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { mpPlatformCredentials, mpEnvGuardError } from "@/lib/mp-platform.server";
import { mpNotificationUrl } from "@/lib/mp-webhook.server";
import { publicOrigin } from "@/lib/app-origin.server";
import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { findOrCreateSubscriberClient } from "@/lib/subscription.server";

/**
 * Cria uma assinatura (Preapproval) no Mercado Pago para um plano da
 * barbearia. Diferente do Checkout Pro de pagamento único, a cobrança é
 * sempre feita na conta da própria barbearia (nunca split por barbeiro) e
 * exige o cliente logado, já que a assinatura precisa ficar vinculada a
 * uma conta para o cliente acompanhar/cancelar depois.
 */

const requestSchema = z.object({
  plan_id: z.string().uuid(),
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

export const Route = createFileRoute("/api/public/mercadopago-preapproval")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados da assinatura inválidos." }, 400);

          const envError = mpEnvGuardError();
          if (envError) return json({ error: envError }, 503);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "A assinatura está temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "É preciso estar logado para assinar um plano." }, 401);
          }
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: plan, error: planError } = await admin
            .from("subscription_plans")
            .select("id, barbershop_id, name, price, active")
            .eq("id", parsed.data.plan_id)
            .maybeSingle();
          if (planError) {
            console.error("Assinatura: falha ao buscar plano", planError);
            return json({ error: "Não foi possível carregar o plano." }, 500);
          }
          const chosenPlan = plan as
            | { id: string; barbershop_id: string; name: string; price: number; active: boolean }
            | null;
          if (!chosenPlan || !chosenPlan.active) {
            return json({ error: "Este plano não está mais disponível." }, 404);
          }

          const { data: shop, error: shopError } = await admin
            .from("barbershops")
            .select("mp_access_token")
            .eq("id", chosenPlan.barbershop_id)
            .maybeSingle();
          if (shopError) {
            console.error("Assinatura: falha ao buscar barbearia", shopError);
            return json({ error: "Não foi possível carregar a conta de pagamento." }, 500);
          }

          const platform = mpPlatformCredentials();
          const shopToken = String((shop as { mp_access_token?: string | null } | null)?.mp_access_token ?? "").trim();
          const candidates: string[] = [];
          if (shopToken && !shopToken.toUpperCase().startsWith("TEST-")) candidates.push(shopToken);
          if (platform?.accessToken) candidates.push(platform.accessToken);
          if (candidates.length === 0) {
            return json({ error: "Esta barbearia ainda não conectou o Mercado Pago." }, 400);
          }

          const payerEmail = (user.email ?? "").trim().toLowerCase();
          if (!payerEmail) {
            return json({ error: "Sua conta precisa ter um e-mail para assinar." }, 400);
          }
          const displayName = String(
            (user.user_metadata as Record<string, string> | null)?.name || payerEmail.split("@")[0],
          );

          const clientId = await findOrCreateSubscriberClient(admin, {
            barbershopId: chosenPlan.barbershop_id,
            userId: user.id,
            name: displayName,
            email: payerEmail,
          });
          if (!clientId) {
            return json({ error: "Não foi possível identificar seu cadastro de cliente." }, 500);
          }

          const pending = await admin
            .from("client_subscriptions")
            .insert({
              plan_id: chosenPlan.id,
              client_id: clientId,
              barbershop_id: chosenPlan.barbershop_id,
              status: "pending",
              mp_payer_email: payerEmail,
            })
            .select("id")
            .maybeSingle();
          if (pending.error || !pending.data?.id) {
            console.error("Assinatura: falha ao criar registro pendente", pending.error);
            return json({ error: "Não foi possível iniciar a assinatura." }, 500);
          }
          const subscriptionId = String(pending.data.id);

          const origin = publicOrigin(request.url);
          const preapprovalBody = {
            reason: chosenPlan.name,
            external_reference: subscriptionId,
            payer_email: payerEmail,
            back_url: `${origin}/assinatura-confirmada/${subscriptionId}`,
            notification_url: mpNotificationUrl(request.url),
            auto_recurring: {
              frequency: 1,
              frequency_type: "months",
              transaction_amount: Number(Number(chosenPlan.price).toFixed(2)),
              currency_id: "BRL",
            },
          };

          let lastError = "Não foi possível iniciar a assinatura.";
          for (const token of candidates) {
            const res = await fetch("https://api.mercadopago.com/preapproval", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "content-type": "application/json",
                accept: "application/json",
                "X-Idempotency-Key": `preapproval-${subscriptionId}`,
              },
              body: JSON.stringify(preapprovalBody),
            });
            const rawBody = await res.text().catch(() => "");
            let body: { id?: string; init_point?: string; status?: string; message?: string; error?: string } = {};
            try {
              body = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              body = {};
            }

            if (res.ok && body.init_point && body.id) {
              await admin
                .from("client_subscriptions")
                .update({ mp_preapproval_id: String(body.id) })
                .eq("id", subscriptionId);
              return json({ subscription_id: subscriptionId, init_point: body.init_point });
            }

            console.error("Assinatura: preapproval recusado", {
              status: res.status,
              body: rawBody.slice(0, 1000),
            });
            lastError = body.message || body.error || lastError;
            // Token inválido/sem permissão: tenta o próximo candidato (fallback da plataforma).
            if (res.status !== 401 && res.status !== 403) break;
          }

          // Nenhum token funcionou: descarta o registro pendente para não poluir
          // a lista de assinantes com uma linha que nunca virou assinatura de verdade.
          await admin.from("client_subscriptions").delete().eq("id", subscriptionId);
          return json({ error: lastError }, 400);
        } catch (error) {
          console.error("Assinatura: erro inesperado", error);
          return json({ error: "Não foi possível iniciar a assinatura." }, 500);
        }
      },
    },
  },
});

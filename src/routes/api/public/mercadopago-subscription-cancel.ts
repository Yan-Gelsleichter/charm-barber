import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { mpPlatformCredentials } from "@/lib/mp-platform.server";
import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/** Cancela uma assinatura, tanto pelo próprio cliente quanto pelo admin da barbearia. */

const requestSchema = z.object({
  subscription_id: z.string().uuid(),
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

export const Route = createFileRoute("/api/public/mercadopago-subscription-cancel")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) return json({ error: "É preciso estar logado." }, 401);
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: sub, error: subError } = await admin
            .from("client_subscriptions")
            .select("id, client_id, barbershop_id, status, mp_preapproval_id")
            .eq("id", parsed.data.subscription_id)
            .maybeSingle();
          if (subError) {
            console.error("Cancelar assinatura: falha ao buscar assinatura", subError);
            return json({ error: "Não foi possível localizar a assinatura." }, 500);
          }
          const subscription = sub as
            | {
                id: string;
                client_id: string;
                barbershop_id: string;
                status: string;
                mp_preapproval_id: string | null;
              }
            | null;
          if (!subscription) return json({ error: "Assinatura não encontrada." }, 404);

          const [{ data: client }, { data: adminBarber }] = await Promise.all([
            admin.from("clients").select("user_id").eq("id", subscription.client_id).maybeSingle(),
            admin
              .from("barbers")
              .select("id")
              .eq("barbershop_id", subscription.barbershop_id)
              .eq("user_id", user.id)
              .eq("is_admin", true)
              .maybeSingle(),
          ]);
          const isOwner = (client as { user_id?: string | null } | null)?.user_id === user.id;
          const isShopAdmin = !!(adminBarber as { id?: string } | null)?.id;
          if (!isOwner && !isShopAdmin) {
            return json({ error: "Você não tem permissão para cancelar esta assinatura." }, 403);
          }

          if (subscription.status === "cancelled") {
            return json({ ok: true, already_cancelled: true });
          }

          if (subscription.mp_preapproval_id) {
            const { data: shop } = await admin
              .from("barbershops")
              .select("mp_access_token")
              .eq("id", subscription.barbershop_id)
              .maybeSingle();
            const platform = mpPlatformCredentials();
            const token =
              String((shop as { mp_access_token?: string | null } | null)?.mp_access_token ?? "").trim() ||
              platform?.accessToken ||
              "";
            if (token) {
              const res = await fetch(
                `https://api.mercadopago.com/preapproval/${encodeURIComponent(subscription.mp_preapproval_id)}`,
                {
                  method: "PUT",
                  headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
                  body: JSON.stringify({ status: "cancelled" }),
                },
              );
              if (!res.ok) {
                const text = await res.text().catch(() => "");
                console.error("Cancelar assinatura: Mercado Pago recusou o cancelamento", {
                  status: res.status,
                  body: text.slice(0, 500),
                });
                // Segue e cancela localmente mesmo assim: o cliente pediu para
                // cancelar e não deve continuar sendo cobrado por causa de uma
                // falha de comunicação com o Mercado Pago.
              }
            }
          }

          const { error: updateError } = await admin
            .from("client_subscriptions")
            .update({ status: "cancelled", cancel_at_period_end: false })
            .eq("id", subscription.id);
          if (updateError) {
            console.error("Cancelar assinatura: falha ao atualizar status local", updateError);
            return json({ error: "Não foi possível registrar o cancelamento." }, 500);
          }

          return json({ ok: true });
        } catch (error) {
          console.error("Cancelar assinatura: erro inesperado", error);
          return json({ error: "Não foi possível cancelar a assinatura." }, 500);
        }
      },
    },
  },
});

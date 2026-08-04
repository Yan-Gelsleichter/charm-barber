import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function backTo(appUrl: string, params: Record<string, string>, tab = "pagamentos") {
  const target = new URL(`${appUrl}/painel`);
  target.searchParams.set("tab", tab);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return Response.redirect(target.toString(), 302);
}

export const Route = createFileRoute("/api/public/mercadopago-oauth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const appUrl = process.env["APP_URL"] || url.origin;
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state"); // barbershop_id
        const errorParam = url.searchParams.get("error");

        try {
          if (errorParam) return backTo(appUrl, { mp: "erro", mp_msg: errorParam });
          if (!code || !state) return backTo(appUrl, { mp: "erro", mp_msg: "code/state ausente" });

          const redirectUri = `${appUrl}/api/public/mercadopago-oauth`;


          const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              grant_type: "authorization_code",
              client_id: process.env["MP_CLIENT_ID"],
              client_secret: process.env["MP_CLIENT_SECRET"],
              code,
              redirect_uri: redirectUri,
            }),
          });
          const token = (await tokenRes.json()) as {
            access_token?: string;
            refresh_token?: string;
            user_id?: number | string;
            message?: string;
            error?: string;
          };
          if (!tokenRes.ok || !token.access_token) {
            return backTo(appUrl, {
              mp: "erro",
              mp_msg: String(token.message ?? token.error ?? "falha no token"),
            });
          }

          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"];
          const supabaseKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];
          if (!supabaseUrl || !supabaseKey) {
            return backTo(appUrl, {
              mp: "erro",
              mp_msg: "Credenciais do banco ausentes no servidor (SB_URL / SB_SERVICE_ROLE_KEY)",
            });
          }

          const admin = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // state = "<barbershop_id>" (conta única) ou "barber:<barber_id>" (split por subcontas)
          const isBarber = state.startsWith("barber:");
          const table = isBarber ? "barbers" : "barbershops";
          const rowId = isBarber ? state.slice("barber:".length) : state;
          const tab = "pagamentos";

          const { error } = await admin
            .from(table)
            .update({
              mp_access_token: token.access_token,
              mp_refresh_token: token.refresh_token ?? null,
              mp_user_id: token.user_id ? String(token.user_id) : null,
            })
            .eq("id", rowId);
          if (error) return backTo(appUrl, { mp: "erro", mp_msg: error.message }, tab);

          return backTo(appUrl, { mp: "ok" }, tab);
        } catch (e) {
          return backTo(appUrl, { mp: "erro", mp_msg: (e as Error).message });
        }
      },
    },
  },
});

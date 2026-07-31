// Supabase Edge Function: mercadopago-oauth
// Callback do Mercado Pago Connect (OAuth).
//
// Fluxo:
//   1. O painel redireciona o dono da barbearia para
//      https://auth.mercadopago.com/authorization?client_id=...&response_type=code
//        &platform_id=mp&state=<barbershop_id>&redirect_uri=<URL desta função>
//   2. O Mercado Pago devolve ?code=...&state=<barbershop_id> aqui.
//   3. Trocamos o code pelo access_token e gravamos na linha da barbearia.
//
// Deploy:  supabase functions deploy mercadopago-oauth --no-verify-jwt
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI (URL pública desta função),
//   APP_URL (ex.: https://charm-barber.lovable.app), SERVICE_ROLE_KEY

// deno-lint-ignore-file
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const APP_URL = Deno.env.get("APP_URL") ?? "";
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // barbershop_id
  const errorParam = url.searchParams.get("error");

  const back = (params: Record<string, string>) => {
    const target = new URL(`${APP_URL || url.origin}/painel`);
    target.searchParams.set("tab", "pagamentos");
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    return Response.redirect(target.toString(), 302);
  };

  try {
    if (errorParam) return back({ mp: "erro", mp_msg: errorParam });
    if (!code || !state) return back({ mp: "erro", mp_msg: "code/state ausente" });

    const CLIENT_ID = Deno.env.get("MP_CLIENT_ID")!;
    const CLIENT_SECRET = Deno.env.get("MP_CLIENT_SECRET")!;
    const REDIRECT_URI = Deno.env.get("MP_REDIRECT_URI") ?? url.origin + url.pathname;

    const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) {
      return back({ mp: "erro", mp_msg: String(token.message ?? token.error ?? "falha no token") });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin
      .from("barbershops")
      .update({
        mp_access_token: token.access_token,
        mp_refresh_token: token.refresh_token ?? null,
        mp_user_id: token.user_id ? String(token.user_id) : null,
      })
      .eq("id", state);
    if (error) return back({ mp: "erro", mp_msg: error.message });

    return back({ mp: "ok" });
  } catch (e) {
    return back({ mp: "erro", mp_msg: (e as Error).message });
  }
});

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
        const rawState = url.searchParams.get("state"); // barbershop_id [|pkce:<verifier>]
        const errorParam = url.searchParams.get("error");

        try {
          if (errorParam) return backTo(appUrl, { mp: "erro", mp_msg: errorParam });
          // Sem code/state não houve retorno do OAuth (acesso direto/preload): não processa nada.
          if (!code || !rawState) return Response.redirect(appUrl, 302);

          // O state pode carregar o code_verifier do PKCE: "<state>|pkce:<verifier>"
          const pkceIdx = rawState.indexOf("|pkce:");
          const state = pkceIdx >= 0 ? rawState.slice(0, pkceIdx) : rawState;
          const codeVerifier = pkceIdx >= 0 ? rawState.slice(pkceIdx + "|pkce:".length) : null;

          // Deve ser byte a byte igual à URL usada na autorização e cadastrada
          // na aplicação do Mercado Pago.
          const redirectUri = "https://charm-barber.lovable.app/api/public/mercadopago-oauth";


          const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              grant_type: "authorization_code",
              client_id: process.env["MP_CLIENT_ID"],
              client_secret: process.env["MP_CLIENT_SECRET"],
              code,
              redirect_uri: redirectUri,
              ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
            }),
          });

          const token = (await tokenRes.json()) as {
            access_token?: string;
            refresh_token?: string;
            user_id?: number | string;
            public_key?: string;
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

          // Valida que a linha alvo existe e, se já estiver conectada, que é a
          // mesma conta do Mercado Pago (evita gravar credenciais de terceiros).
          const { data: targetRow, error: targetErr } = await admin
            .from(table)
            .select("id, mp_user_id")
            .eq("id", rowId)
            .maybeSingle();
          if (targetErr || !targetRow) {
            return backTo(appUrl, { mp: "erro", mp_msg: "Conta da barbearia não encontrada" }, tab);
          }

          // Dono real do access_token, confirmado direto na API do Mercado Pago.
          const { fetchMpAccountId, registerMpWebhook } = await import(
            "@/lib/mp-webhook-register.server"
          );
          const accountId = await fetchMpAccountId(token.access_token);
          const tokenUserId = token.user_id ? String(token.user_id) : null;
          if (!accountId || (tokenUserId && accountId !== tokenUserId)) {
            return backTo(
              appUrl,
              { mp: "erro", mp_msg: "Não foi possível confirmar a conta do Mercado Pago" },
              tab,
            );
          }

          const existingMpUser = (targetRow as { mp_user_id?: string | null }).mp_user_id ?? null;
          if (existingMpUser && existingMpUser !== accountId) {
            return backTo(
              appUrl,
              { mp: "erro", mp_msg: "Esta barbearia já está conectada a outra conta do Mercado Pago" },
              tab,
            );
          }

          // A mesma conta MP não pode ficar vinculada a duas barbearias/barbeiros.
          const { data: conflict } = await admin
            .from(table)
            .select("id")
            .eq("mp_user_id", accountId)
            .neq("id", rowId)
            .limit(1)
            .maybeSingle();
          if (conflict) {
            return backTo(
              appUrl,
              { mp: "erro", mp_msg: "Esta conta do Mercado Pago já está vinculada a outro cadastro" },
              tab,
            );
          }

          const payload: Record<string, unknown> = {
            mp_access_token: token.access_token,
            mp_refresh_token: token.refresh_token ?? null,
            mp_user_id: accountId,
          };
          if (token.public_key) payload["mp_public_key"] = token.public_key;

          // Registra o webhook automaticamente na conta conectada e captura a
          // "Assinatura secreta". Só grava se a secret comprovadamente pertence
          // a esta conta (URL do nosso app e dono igual à conta autenticada).
          // Em reconexões, os webhooks antigos são apagados antes (rotação),
          // invalidando a assinatura anterior no Mercado Pago.
          const isReconnect = !!existingMpUser;
          let webhookSecret: string | null = null;
          try {
            const result = await registerMpWebhook({
              accessToken: token.access_token,
              appUrl: process.env["APP_URL"] || "https://charm-barber.lovable.app",
              applicationId: process.env["MP_CLIENT_ID"] ?? null,
              rotate: isReconnect,
            });
            const ownerOk = !result.ownerId || result.ownerId === accountId;
            if (result.secret && result.urlMatches && ownerOk) webhookSecret = result.secret;
          } catch {
            /* conexão continua mesmo se o registro do webhook falhar */
          }
          // Sempre sobrescreve: se a nova secret não veio, a antiga é apagada
          // para não continuar validando notificações com uma chave revogada.
          payload["mp_webhook_secret"] = webhookSecret;

          let { error } = await admin.from(table).update(payload).eq("id", rowId);
          // As colunas mp_public_key / mp_webhook_secret podem não existir no banco.
          if (error) {
            delete payload["mp_public_key"];
            delete payload["mp_webhook_secret"];
            ({ error } = await admin.from(table).update(payload).eq("id", rowId));
          }
          if (error) return backTo(appUrl, { mp: "erro", mp_msg: error.message }, tab);


          return backTo(appUrl, { mp: "ok" }, tab);
        } catch (e) {
          return backTo(appUrl, { mp: "erro", mp_msg: (e as Error).message });
        }
      },
    },
  },
});

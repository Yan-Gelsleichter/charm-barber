import { createFileRoute } from "@tanstack/react-router";

const REDIRECT_URI = "https://charm-barber.lovable.app/api/public/mercadopago-oauth";

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const Route = createFileRoute("/api/public/mercadopago-connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = requestUrl.searchParams.get("target")?.trim() ?? "";
        const isShop = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          target,
        );
        const isBarber = /^barber:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          target,
        );
        if (!isShop && !isBarber) {
          return Response.json({ error: "Destino de conexão inválido" }, { status: 400 });
        }

        const clientId = process.env["MP_CLIENT_ID"]?.trim();
        if (!clientId) {
          return Response.json({ error: "MP_CLIENT_ID não configurado no servidor" }, { status: 503 });
        }

        const raw = new Uint8Array(32);
        crypto.getRandomValues(raw);
        const verifier = base64url(raw);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        );
        const challenge = base64url(new Uint8Array(digest));
        const state = `${target}|pkce:${verifier}`;

        const authorizationUrl = new URL("https://auth.mercadopago.com/authorization");
        authorizationUrl.searchParams.set("response_type", "code");
        authorizationUrl.searchParams.set("client_id", clientId);
        authorizationUrl.searchParams.set("redirect_uri", REDIRECT_URI);
        authorizationUrl.searchParams.set("state", state);
        authorizationUrl.searchParams.set("code_challenge", challenge);
        authorizationUrl.searchParams.set("code_challenge_method", "S256");

        return Response.redirect(authorizationUrl.toString(), 302);
      },
    },
  },
});
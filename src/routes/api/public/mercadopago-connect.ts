import { createFileRoute } from "@tanstack/react-router";

const REDIRECT_URI = "https://charm-barber.lovable.app/api/public/mercadopago-oauth";

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

        const authorizationUrl = new URL("https://auth.mercadopago.com/authorization");
        authorizationUrl.searchParams.set("response_type", "code");
        authorizationUrl.searchParams.set("client_id", clientId);
        authorizationUrl.searchParams.set("redirect_uri", REDIRECT_URI);
        authorizationUrl.searchParams.set("state", target);

        return Response.redirect(authorizationUrl.toString(), 302);
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";

import { handleNotification } from "@/lib/mp-webhook-handler.server";

export const Route = createFileRoute("/api/public/mercadopago-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await handleNotification(request);
        } catch (error) {
          console.error("Webhook MP: erro inesperado", error);
          return new Response("error", { status: 500 });
        }
      },
      // O Mercado Pago valida a URL com GET em algumas configurações.
      GET: async ({ request }) => {
        try {
          return await handleNotification(request);
        } catch {
          return new Response("ok", { status: 200 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { handleNotification } from "@/lib/mp-webhook-handler.server";

/** Alias público do webhook do Mercado Pago: /api/public/webhooks/mercadopago */
export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await handleNotification(request);
        } catch (error) {
          console.error("Webhook MP: erro inesperado", error);
          return new Response("error", { status: 200 });
        }
      },
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

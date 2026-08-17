import { createFileRoute } from "@tanstack/react-router";

import { handleNotification } from "@/lib/mp-webhook-handler.server";

/** Alias solicitado: /api/webhooks/mercadopago (mesma lógica do endpoint público). */
export const Route = createFileRoute("/api/webhooks/mercadopago")({
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

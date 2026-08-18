import { createFileRoute } from "@tanstack/react-router";

/** Diagnóstico temporário das credenciais do Mercado Pago. */
export const Route = createFileRoute("/api/public/mp-diag")({
  server: {
    handlers: {
      GET: async () => {
        const token = (process.env["MP_ACCESS_TOKEN"] ?? "").trim();
        const origin = "https://charm-barber.lovable.app";
        const backUrl = `${origin}/pagamento-confirmado/00000000-0000-0000-0000-000000000000`;
        const body: Record<string, unknown> = {
          items: [
            {
              id: "svc",
              title: "Corte",
              description: "Agendamento na barbearia",
              quantity: 1,
              currency_id: "BRL",
              unit_price: 35,
            },
          ],
          payer: { email: "teste@example.com", name: "Cliente" },
          external_reference: "diag2",
          notification_url: `${origin}/api/public/webhooks/mercadopago`,
          back_urls: {
            success: `${backUrl}?status=success`,
            pending: `${backUrl}?status=pending`,
            failure: `${backUrl}?status=failure`,
          },
          auto_return: "approved",
          payment_methods: {
            excluded_payment_methods: [],
            excluded_payment_types: [],
            installments: 12,
            default_installments: 1,
          },
          binary_mode: false,
          statement_descriptor: "BARBEARIA",
          metadata: { appointment_id: "x", payout_mode: "unica" },
        };
        const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return Response.json({ status: res.status, body: (await res.text()).slice(0, 1200) });
      },
    },
  },
});

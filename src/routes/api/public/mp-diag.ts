import { createFileRoute } from "@tanstack/react-router";

/** Diagnóstico temporário das credenciais do Mercado Pago. */
export const Route = createFileRoute("/api/public/mp-diag")({
  server: {
    handlers: {
      GET: async () => {
        const token = (process.env["MP_ACCESS_TOKEN"] ?? "").trim();
        const out: Record<string, unknown> = {
          hasToken: Boolean(token),
          tokenPrefix: token.slice(0, 8),
          hasPublicKey: Boolean((process.env["MP_PUBLIC_KEY"] ?? "").trim()),
          appUrl: process.env["APP_URL"] ?? null,
        };
        if (token) {
          const me = await fetch("https://api.mercadopago.com/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          out["meStatus"] = me.status;
          out["meBody"] = (await me.text()).slice(0, 400);

          const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              items: [
                { title: "Teste", quantity: 1, currency_id: "BRL", unit_price: 10 },
              ],
              external_reference: "diag",
            }),
          });
          out["prefStatus"] = pref.status;
          out["prefBody"] = (await pref.text()).slice(0, 600);
        }
        return Response.json(out);
      },
    },
  },
});

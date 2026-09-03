import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Diz se um agendamento (ou uma barbearia) já pode receber pagamento online
 * — sem expor nenhum token. Usado pelas telas do cliente pra decidir se
 * mostra "Pagar Online"/"Assinar", já que o navegador nunca tem acesso
 * direto às colunas mp_access_token (revogadas de SELECT por segurança).
 *
 * Mesma regra de quem recebe o dinheiro usada em mercadopago-preference.ts
 * e mercadopago-preapproval.ts: barbeiro (modo dividido) ou barbearia —
 * nunca uma conta "coringa" da plataforma.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

function hasToken(value: string | null | undefined): boolean {
  const token = String(value ?? "").trim();
  return !!token && !token.toUpperCase().startsWith("TEST-");
}

export const Route = createFileRoute("/api/public/mercadopago-connection")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const appointmentId = url.searchParams.get("appointment_id");
          let barbershopId = url.searchParams.get("barbershop_id");
          let barberId = url.searchParams.get("barber_id");

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          if (appointmentId) {
            const { data: appt } = await admin
              .from("appointments")
              .select("barbershop_id, barber_id")
              .eq("id", appointmentId)
              .maybeSingle();
            const row = appt as { barbershop_id?: string | null; barber_id?: string | null } | null;
            if (!row) return json({ connected: false });
            barbershopId = row.barbershop_id ?? null;
            barberId = row.barber_id ?? null;
          }

          if (!barbershopId) return json({ error: "Barbearia não informada." }, 400);

          const { data: shop } = await admin
            .from("barbershops")
            .select("mp_access_token, payout_mode")
            .eq("id", barbershopId)
            .maybeSingle();
          const shopRow = shop as { mp_access_token?: string | null; payout_mode?: string | null } | null;

          if (shopRow?.payout_mode === "split" && barberId) {
            const { data: barber } = await admin
              .from("barbers")
              .select("mp_access_token")
              .eq("id", barberId)
              .maybeSingle();
            const barberToken = (barber as { mp_access_token?: string | null } | null)?.mp_access_token;
            if (hasToken(barberToken)) return json({ connected: true });
          }

          return json({ connected: hasToken(shopRow?.mp_access_token) });
        } catch (error) {
          console.error("[mercadopago-connection] erro inesperado", error);
          return json({ connected: false });
        }
      },
    },
  },
});

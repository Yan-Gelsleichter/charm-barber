import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { computeLoyaltyStatus } from "@/lib/loyalty.server";

/**
 * Status de fidelidade de um cliente (por telefone) numa barbearia —
 * usado pela tela do cliente (meus-agendamentos) e pelas telas de
 * agendar (pública e "Novo agendamento" da Agenda) pra saber se mostram
 * a opção de usar um resgate.
 */

const requestSchema = z.object({
  barbershop_id: z.string().uuid(),
  customer_phone: z.string().min(8),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

export const Route = createFileRoute("/api/public/loyalty-status")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const statuses = await computeLoyaltyStatus(admin, {
            barbershopId: parsed.data.barbershop_id,
            phone: parsed.data.customer_phone,
          });

          return json({ programs: statuses });
        } catch (error) {
          console.error("[loyalty-status] erro inesperado", error);
          return json({ error: "Não foi possível consultar a fidelidade." }, 500);
        }
      },
    },
  },
});

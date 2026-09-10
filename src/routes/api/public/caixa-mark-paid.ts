import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Marca manualmente um agendamento como pago no balcão (Dinheiro/Pix/Cartão),
 * pura escrituração administrativa — nunca envolve o Mercado Pago. Só o
 * admin da barbearia dona do agendamento pode fazer isso.
 */

const requestSchema = z.object({
  appointment_id: z.string().uuid(),
  payment_method: z.enum(["dinheiro", "pix", "cartao"]),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-mark-paid")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "É preciso estar logado." }, 401);
          }
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: adminBarber } = await admin
            .from("barbers")
            .select("barbershop_id")
            .eq("user_id", user.id)
            .eq("is_admin", true)
            .maybeSingle();
          const barbershopId = (adminBarber as { barbershop_id?: string } | null)?.barbershop_id;
          if (!barbershopId) {
            return json({ error: "Só o administrador da barbearia pode fazer isso." }, 403);
          }

          const found = await admin
            .from("appointments")
            .select("id, payment_status, barbershop_id")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          const row = found.data as
            | { id: string; payment_status?: string | null; barbershop_id?: string | null }
            | null;
          if (found.error || !row) {
            return json({ error: "Agendamento não encontrado." }, 404);
          }
          if (row.barbershop_id !== barbershopId) {
            return json({ error: "Esse agendamento não é dessa barbearia." }, 403);
          }
          if (row.payment_status === "pago") {
            return json({ ok: true, already_paid: true });
          }

          const updated = await admin
            .from("appointments")
            .update({
              payment_status: "pago",
              payment_method: parsed.data.payment_method,
              paid_at: new Date().toISOString(),
            })
            .eq("id", parsed.data.appointment_id)
            .select("id, payment_status, payment_method, paid_at")
            .maybeSingle();
          if (updated.error || !updated.data) {
            console.error("[caixa-mark-paid] falha ao atualizar", updated.error);
            return json({ error: "Não foi possível marcar como pago." }, 500);
          }

          return json({ ok: true, appointment: updated.data });
        } catch (error) {
          console.error("[caixa-mark-paid] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Confirma (ou desfaz) que um agendamento pago realmente aconteceu —
 * "comparecimento confirmado" é uma ação manual, separada de só o
 * horário ter passado (ver docs/add-loyalty-program.sql), pra um
 * no-show nunca contar ponto de fidelidade sozinho. Alterna a cada
 * chamada. Autorizado pro admin da barbearia OU pro próprio barbeiro
 * dono do agendamento (barbeiro comum sem acesso ao Caixa também
 * precisa poder confirmar os próprios atendimentos, pela Agenda).
 */

const requestSchema = z.object({ appointment_id: z.string().uuid() });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/appointment-confirm-attendance")({
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

          const { data: me } = await admin
            .from("barbers")
            .select("id, barbershop_id, is_admin")
            .eq("user_id", user.id)
            .maybeSingle();
          const meBarber = me as { id: string; barbershop_id?: string | null; is_admin?: boolean | null } | null;
          if (!meBarber) return json({ error: "Acesso restrito." }, 403);

          const found = await admin
            .from("appointments")
            .select("id, barber_id, barbershop_id, payment_status, attendance_confirmed")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          const row = found.data as
            | {
                id: string;
                barber_id: string;
                barbershop_id?: string | null;
                payment_status?: string | null;
                attendance_confirmed?: boolean | null;
              }
            | null;
          if (found.error || !row) return json({ error: "Agendamento não encontrado." }, 404);

          const isOwner = row.barber_id === meBarber.id;
          const isShopAdmin =
            meBarber.is_admin === true && meBarber.barbershop_id && meBarber.barbershop_id === row.barbershop_id;
          if (!isOwner && !isShopAdmin) {
            return json({ error: "Você não tem acesso a esse agendamento." }, 403);
          }
          if (row.payment_status !== "pago") {
            return json({ error: "Só é possível confirmar comparecimento de um agendamento pago." }, 400);
          }

          const nextValue = !row.attendance_confirmed;
          const updated = await admin
            .from("appointments")
            .update({
              attendance_confirmed: nextValue,
              attendance_confirmed_at: nextValue ? new Date().toISOString() : null,
            })
            .eq("id", row.id)
            .select("id, attendance_confirmed")
            .maybeSingle();
          if (updated.error || !updated.data) {
            console.error("[appointment-confirm-attendance] falha ao atualizar", updated.error);
            return json({ error: "Não foi possível salvar a confirmação." }, 500);
          }

          return json({ ok: true, attendance_confirmed: updated.data.attendance_confirmed });
        } catch (error) {
          console.error("[appointment-confirm-attendance] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

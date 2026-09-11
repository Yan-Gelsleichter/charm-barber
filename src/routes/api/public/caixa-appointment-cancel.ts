import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { cancellationMarkerName, cancellationMarkerTime } from "@/lib/availability";

/**
 * Cancela (não exclui) um agendamento vindo do app, pelo Caixa — mesmo
 * mecanismo usado quando o próprio cliente cancela em meus-agendamentos.tsx
 * (marca status='cancelado' na linha + insere uma linha-marcador), só que
 * autenticado como admin da barbearia em vez de dono do telefone. Mantém
 * histórico. Atendimentos avulsos usam caixa-walkin-delete.ts (exclusão de
 * verdade), não este endpoint.
 */

const requestSchema = z.object({ appointment_id: z.string().uuid() });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-appointment-cancel")({
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
            .select(
              "id, barber_id, service_id, barbershop_id, customer_name, appointment_time, status, payment_status, is_walk_in",
            )
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          const row = found.data as
            | {
                id: string;
                barber_id: string;
                service_id: string;
                barbershop_id?: string | null;
                customer_name: string;
                appointment_time: string;
                status: string;
                payment_status?: string | null;
                is_walk_in?: boolean | null;
              }
            | null;
          if (found.error || !row) return json({ error: "Agendamento não encontrado." }, 404);
          if (row.barbershop_id !== barbershopId) {
            return json({ error: "Esse agendamento não é dessa barbearia." }, 403);
          }
          if (row.is_walk_in) {
            return json(
              { error: "Atendimentos avulsos são excluídos, não cancelados — use a opção de excluir." },
              400,
            );
          }
          if ((row.status || "").trim().toLowerCase() === "cancelado") {
            return json({ ok: true, was_paid: row.payment_status === "pago", already_cancelled: true });
          }

          const wasPaid = row.payment_status === "pago";

          const updated = await admin
            .from("appointments")
            .update({ status: "cancelado" })
            .eq("id", row.id)
            .select("id")
            .maybeSingle();
          if (updated.error || !updated.data) {
            console.error("[caixa-appointment-cancel] falha ao marcar cancelado", updated.error);
            return json({ error: "Não foi possível cancelar o agendamento." }, 500);
          }

          // Marcador redundante (mesmo padrão de meus-agendamentos.tsx): garante
          // que a disponibilidade libera o horário mesmo se algo mais tarde só
          // olhar pelo id do marcador em vez do status da linha original.
          const { error: markerError } = await admin.from("appointments").insert({
            barber_id: row.barber_id,
            service_id: row.service_id,
            barbershop_id: barbershopId,
            customer_name: cancellationMarkerName(row.id, row.customer_name),
            customer_phone: "",
            appointment_time: cancellationMarkerTime(row.appointment_time),
            status: "cancelado",
            is_walk_in: true,
          });
          if (markerError) {
            console.error("[caixa-appointment-cancel] falha ao inserir marcador", markerError);
          }

          return json({ ok: true, was_paid: wasPaid });
        } catch (error) {
          console.error("[caixa-appointment-cancel] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

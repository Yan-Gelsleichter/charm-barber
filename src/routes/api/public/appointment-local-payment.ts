import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Marca um agendamento como "pagar presencialmente".
 * A atualização direta pelo cliente pode ser bloqueada por RLS (o cliente só
 * tem SELECT em appointments), então fazemos aqui com a service role, depois
 * de validar o token do usuário logado.
 */

const requestSchema = z.object({ appointment_id: z.string().uuid() });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/appointment-local-payment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente para continuar." }, 401);
          }

          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Agendamento inválido." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) {
            return json({ error: "Serviço temporariamente indisponível." }, 503);
          }

          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: userError } = await admin.auth.getUser(bearer);
          if (userError || !userData.user) {
            return json({ error: "Sua sessão expirou. Faça login novamente." }, 401);
          }

          const found = await admin
            .from("appointments")
            .select("id, payment_status, barbershop_id, barber_id")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          if (found.error || !found.data) {
            return json({ error: "Agendamento não encontrado no banco de dados." }, 404);
          }
          const appointmentRow = found.data as {
            id: string;
            payment_status?: string | null;
            barbershop_id?: string | null;
            barber_id?: string | null;
          };
          if (appointmentRow.payment_status === "pago") {
            return json({
              ok: true,
              already_paid: true,
              appointment: {
                id: appointmentRow.id,
                payment_method: null,
                payment_status: "pago",
              },
            });
          }

          // Mesma regra da tela: pagamento presencial só é bloqueado quando o
          // admin desativou essa opção E existe de fato uma conexão ativa com
          // o Mercado Pago agora — nunca deixa o agendamento sem nenhuma
          // forma de pagamento possível.
          if (appointmentRow.barbershop_id) {
            const { data: shop } = await admin
              .from("barbershops")
              .select("mp_access_token, payout_mode, allow_local_payment")
              .eq("id", appointmentRow.barbershop_id)
              .maybeSingle();
            const shopRow = shop as {
              mp_access_token?: string | null;
              payout_mode?: string | null;
              allow_local_payment?: boolean | null;
            } | null;
            const hasToken = (value: string | null | undefined) => {
              const token = String(value ?? "").trim();
              return !!token && !token.toUpperCase().startsWith("TEST-");
            };
            let connected = hasToken(shopRow?.mp_access_token);
            if (!connected && shopRow?.payout_mode === "split" && appointmentRow.barber_id) {
              const { data: barber } = await admin
                .from("barbers")
                .select("mp_access_token")
                .eq("id", appointmentRow.barber_id)
                .maybeSingle();
              connected = hasToken((barber as { mp_access_token?: string | null } | null)?.mp_access_token);
            }
            if (connected && shopRow?.allow_local_payment === false) {
              return json(
                { error: "Esta barbearia exige pagamento online. Escolha Pix ou cartão para continuar." },
                400,
              );
            }
          }

          const updated = await admin
            .from("appointments")
            .update({ payment_method: "presencial", payment_status: "pendente" })
            .eq("id", parsed.data.appointment_id)
            .select("id, payment_method, payment_status")
            .maybeSingle();
          if (updated.error || !updated.data) {
            console.error("[local-payment] update ou confirmação falhou", updated.error);
            return json({ error: "Não foi possível registrar o pagamento presencial." }, 500);
          }

          return json({ ok: true, appointment: updated.data });
        } catch (error) {
          console.error("[local-payment] erro inesperado", error);
          return json({ error: "Erro inesperado ao registrar o pagamento presencial." }, 500);
        }
      },
    },
  },
});

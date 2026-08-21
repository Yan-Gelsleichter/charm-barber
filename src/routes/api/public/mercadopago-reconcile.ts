/**
 * Reconciliação imediata de UM agendamento.
 *
 * Chamado pela tela de confirmação assim que o cliente volta do Checkout Pro:
 * consulta o pagamento direto na API do Mercado Pago e grava o status real no
 * agendamento, sem depender do webhook chegar primeiro.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { findMercadoPagoPayment, paymentBelongsToAppointment } from "@/lib/mp-lookup.server";
import { mpPlatformCredentials } from "@/lib/mp-platform.server";
import { mapPaymentStatus } from "@/lib/mp-status.server";
import { withReconcileLock } from "@/lib/mp-reconcile-lock.server";
import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

const requestSchema = z.object({
  appointment_id: z.string().uuid(),
  payment_id: z.string().trim().max(64).optional(),
  merchant_order_id: z.string().trim().max(64).optional(),
  preference_id: z.string().trim().max(128).optional(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export const Route = createFileRoute("/api/public/mercadopago-reconcile")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          // Sessão é opcional: clientes anônimos também precisam reconciliar.



          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          // Idempotência: chamadas concorrentes (polling em várias abas) para o
          // mesmo agendamento compartilham uma única execução.
          const core = async (): Promise<Response> => {


          const admin = createSupabaseAdmin();
          if (!admin) {
            return json({ error: "Serviço indisponível." }, 503);
          }

          const { data, error } = await admin
            .from("appointments")
            .select("id, email, barber_id, barbershop_id, mp_payment_id, payment_status, payment_method, paid_at")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          if (error) return json({ error: "Não foi possível verificar o pagamento." }, 500);
          const appointment = data as {
            id: string;
            email: string | null;
            barber_id: string | null;
            barbershop_id: string | null;
            mp_payment_id: string | null;
            payment_status: string | null;
            payment_method: string | null;
            paid_at: string | null;
          } | null;
          if (!appointment) return json({ error: "Agendamento não encontrado." }, 404);

          // Endpoint público: apenas sincroniza o status real do pagamento no
          // Mercado Pago para este agendamento (nenhum dado sensível é devolvido).


          if (appointment.payment_status === "pago") {
            // Já está pago: garante que paid_at nunca fique vazio.
            if (!appointment.paid_at) {
              await admin
                .from("appointments")
                .update({ paid_at: new Date().toISOString() })
                .eq("id", appointment.id);
              return json({ payment_status: "pago", updated: true });
            }
            return json({ payment_status: "pago", updated: false });
          }

          // Tenta todas as contas que podem ter criado a preferência. Usar só o
          // primeiro token deixava pagamentos invisíveis quando o checkout havia
          // usado o fallback da barbearia/plataforma.
          const tokens: string[] = [];
          const addToken = (value?: string | null) => {
            const token = String(value ?? "").trim();
            if (token && !tokens.includes(token)) tokens.push(token);
          };
          if (appointment.barber_id) {
            const { data: barber } = await admin
              .from("barbers")
              .select("mp_access_token")
              .eq("id", appointment.barber_id)
              .maybeSingle();
            addToken((barber as { mp_access_token?: string | null } | null)?.mp_access_token);
          }
          if (appointment.barbershop_id) {
            const { data: shop } = await admin
              .from("barbershops")
              .select("mp_access_token")
              .eq("id", appointment.barbershop_id)
              .maybeSingle();
            addToken((shop as { mp_access_token?: string | null } | null)?.mp_access_token);
          }
          addToken(mpPlatformCredentials()?.accessToken);
          if (tokens.length === 0) {
            return json({ payment_status: appointment.payment_status, updated: false });
          }

          // mp_payment_id pode guardar "pref:<preference_id>" (salvo ao criar o Checkout Pro).
          const stored = String(appointment.mp_payment_id ?? "");
          const storedPreferenceId = stored.startsWith("pref:") ? stored.slice(5) : null;
          const preferenceId = parsed.data.preference_id ?? storedPreferenceId;
          // As contas são consultadas em paralelo. Além de reduzir bastante o
          // tempo de retorno, isso evita aceitar um estado pendente de uma conta
          // antes de encontrar o pagamento aprovado na conta que criou o checkout.
          const paymentResults = await Promise.allSettled(
            tokens.map((token) =>
              findMercadoPagoPayment({
                token,
                appointmentId: appointment.id,
                storedRef: appointment.mp_payment_id,
                preferenceId,
                paymentId: parsed.data.payment_id,
                merchantOrderId: parsed.data.merchant_order_id,
              }),
            ),
          );
          const payments = paymentResults.flatMap((result) =>
            result.status === "fulfilled" && result.value?.status ? [result.value] : [],
          );
          const payment =
            payments.find((candidate) => mapPaymentStatus(candidate.status) === "pago") ??
            payments[0] ??
            null;

          if (!payment?.status) {
            return json({ payment_status: appointment.payment_status, updated: false });
          }

          // Nunca permite que um ID de pagamento fornecido pelo navegador
          // quite outro agendamento. A referência é confirmada no objeto
          // autoritativo retornado pelo Mercado Pago.
          if (!paymentBelongsToAppointment(payment, appointment.id)) {
            console.warn("Reconcile MP: pagamento não pertence ao agendamento", {
              appointmentId: appointment.id,
              paymentId: payment.id,
            });
            return json({ payment_status: appointment.payment_status, updated: false }, 409);
          }

          const paymentStatus = mapPaymentStatus(payment.status);
          const mpPaymentId = payment.id ? String(payment.id) : null;
          const paidAt =
            paymentStatus === "pago"
              ? (appointment.paid_at ?? new Date().toISOString())
              : paymentStatus === "estornado"
                ? appointment.paid_at
                : null;

          // Idempotência: se nada mudou, não escreve nada.
          const unchanged =
            appointment.payment_status === paymentStatus &&
            appointment.payment_method === "online" &&
            (appointment.paid_at ?? null) === (paidAt ?? null) &&
            (!mpPaymentId || appointment.mp_payment_id === mpPaymentId);
          if (unchanged) {
            return json({ payment_status: paymentStatus, updated: false });
          }

          const patch: Record<string, unknown> = {
            payment_status: paymentStatus,
            payment_method: "online",
            paid_at: paidAt,
          };
          if (mpPaymentId) patch["mp_payment_id"] = mpPaymentId;

          // Um pagamento aprovado é gravado de forma autoritativa e a resposta
          // só informa "pago" depois que o banco devolve a linha atualizada.
          // Antes, um erro de UPDATE era ignorado e a tela podia mostrar pago sem
          // que appointments tivesse sido persistida.
          if (paymentStatus === "pago") patch["status"] = "confirmado";

          let updateQuery = admin.from("appointments").update(patch).eq("id", appointment.id);
          // Eventos não aprovados não podem rebaixar um pagamento já confirmado.
          if (paymentStatus !== "pago") updateQuery = updateQuery.neq("payment_status", "pago");

          const { data: updatedRows, error: updateError } = await updateQuery.select(
            "id, payment_status, payment_method, paid_at, mp_payment_id",
          );
          if (updateError) {
            console.error("Reconcile MP: falha ao persistir pagamento", updateError);
            return json({ error: "Não foi possível registrar o pagamento.", payment_status: appointment.payment_status }, 500);
          }

          const persisted = Array.isArray(updatedRows) ? updatedRows[0] : null;
          if (!persisted) {
            const { data: currentRow, error: currentError } = await admin
              .from("appointments")
              .select("payment_status")
              .eq("id", appointment.id)
              .maybeSingle();
            if (currentError) {
              console.error("Reconcile MP: falha ao confirmar persistência", currentError);
              return json({ error: "Não foi possível confirmar o pagamento." }, 500);
            }
            const persistedStatus = (currentRow as { payment_status?: string | null } | null)?.payment_status ?? null;
            return json({ payment_status: persistedStatus, updated: false });
          }

          return json({
            payment_status: (persisted as { payment_status?: string }).payment_status ?? paymentStatus,
            updated: true,
          });
          };

          const result = await withReconcileLock(parsed.data.appointment_id, core);
          // Cada chamador recebe uma cópia: o corpo só pode ser lido uma vez.
          return result.clone();

        } catch (e) {
          console.error("Reconcile MP: erro inesperado", e);
          return json({ error: "Não foi possível verificar o pagamento." }, 500);
        }
      },
    },
  },
});

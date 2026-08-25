import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Criação pública e autoritativa de agendamento com service role.
 * O INSERT não depende de sessão do cliente nem das políticas RLS.
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  service_id: z.string().uuid(),
  customer_name: z.string().min(2),
  customer_phone: z.string().regex(/^\d{8,15}$/),
  email: z.string().email().nullable().optional(),
  appointment_time: z.string().min(8),
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

function databaseError(error: {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}) {
  const extra = [error.details, error.hint, error.code ? `código ${error.code}` : null]
    .filter(Boolean)
    .join(" · ");
  return `Erro ao salvar agendamento: ${error.message}${extra ? ` (${extra})` : ""}`;
}

export const Route = createFileRoute("/api/public/appointment-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) {
            const reason = parsed.error.issues[0]?.message ?? "campos obrigatórios ausentes";
            return json({ error: `Erro ao salvar agendamento: dados inválidos (${reason}).` }, 400);
          }

          const admin = createSupabaseAdmin();
          if (!admin) {
            return json({ error: "Erro ao salvar agendamento: serviço temporariamente indisponível." }, 503);
          }

          const d = parsed.data;
          const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
          let userId: string | null = null;
          if (bearer) {
            const { data: authData, error: authError } = await admin.auth.getUser(bearer);
            if (authError) {
              return json({ error: "Erro ao salvar agendamento: sessão do cliente inválida." }, 401);
            }
            userId = authData.user?.id ?? null;
          }

          // appointment_time precisa chegar como timestamptz ISO válido; se vier
          // em outro formato, o Postgres rejeita a chamada inteira.
          const parsedTime = new Date(d.appointment_time);
          if (Number.isNaN(parsedTime.getTime())) {
            return json(
              { error: "Erro ao salvar agendamento: horário inválido (formato de data)." },
              400,
            );
          }
          const appointmentTimeIso = parsedTime.toISOString();

          const rpcArgs = {
            p_barber_id: d.barber_id,
            p_service_id: d.service_id,
            p_customer_name: d.customer_name,
            p_customer_phone: d.customer_phone,
            p_email: d.email ?? "",
            p_appointment_time: appointmentTimeIso,
            p_user_id: userId,
          };

          // Uma única função SQL cria o agendamento e o cliente na mesma
          // transação. Qualquer falha desfaz ambos antes de devolver a resposta.
          const created = await admin.rpc("create_appointment_with_client", rpcArgs);
          const appointmentId = created.data ? String(created.data) : null;

          // Não há fallback com INSERTs separados: a função SQL é a única escrita
          // permitida e confirma appointments + clients na mesma transação.
          if (created.error || !appointmentId) {
            console.error("[appointment-create] RPC falhou", {
              args: { ...rpcArgs, p_customer_phone: `${d.customer_phone.slice(0, 4)}***` },
              message: created.error?.message,
              details: created.error?.details,
              hint: created.error?.hint,
              code: created.error?.code,
            });
            return json(
              {
                error: created.error
                  ? databaseError(created.error)
                  : "Erro ao salvar agendamento: a transação não retornou o registro criado.",
              },
              500,
            );
          }

          // A resposta positiva só existe depois de reler ambas as tabelas.
          const [persistedAppointment, persistedClient] = await Promise.all([
            admin
              .from("appointments")
              .select(
                "id, barber_id, service_id, customer_name, customer_phone, appointment_time, payment_status",
              )
              .eq("id", appointmentId)
              .eq("barber_id", d.barber_id)
              .eq("service_id", d.service_id)
              .maybeSingle(),
            admin
              .from("clients")
              .select("id")
              .eq("barber_id", d.barber_id)
              .eq("whatsapp", d.customer_phone)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle(),
          ]);
          if (
            persistedAppointment.error ||
            !persistedAppointment.data ||
            persistedClient.error ||
            !persistedClient.data
          ) {
            console.error("[appointment-create] confirmação atômica falhou", {
              appointmentId,
              appointmentError: persistedAppointment.error,
              clientError: persistedClient.error,
              appointmentFound: Boolean(persistedAppointment.data),
              clientFound: Boolean(persistedClient.data),
            });
            return json(
              { error: "Erro ao salvar agendamento: o banco não confirmou todos os registros." },
              500,
            );
          }

          const savedAppointment = persistedAppointment.data;
          const savedTime = new Date(savedAppointment.appointment_time).getTime();
          if (
            savedAppointment.customer_phone !== d.customer_phone ||
            savedAppointment.customer_name.trim() !== d.customer_name.trim() ||
            savedTime !== parsedTime.getTime()
          ) {
            console.error("[appointment-create] linha confirmada diverge da solicitação", {
              appointmentId,
              expectedTime: appointmentTimeIso,
              savedTime: savedAppointment.appointment_time,
              phoneMatches: savedAppointment.customer_phone === d.customer_phone,
              nameMatches: savedAppointment.customer_name.trim() === d.customer_name.trim(),
            });
            return json(
              { error: "Erro ao salvar agendamento: os dados gravados não foram confirmados." },
              500,
            );
          }

          return json({
            id: appointmentId,
            client_id: String(persistedClient.data.id),
            persisted: true,
            appointment: savedAppointment,
          });

        } catch (error) {
          console.error("[appointment-create] erro inesperado", error);
          const message = error instanceof Error ? error.message : String(error);
          return json({ error: `Erro ao salvar agendamento: ${message}` }, 500);
        }
      },
    },
  },
});

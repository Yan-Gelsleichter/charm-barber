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

type DatabaseFailure = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

function databaseError(error: DatabaseFailure, target: "agendamento" | "cliente") {
  const extra = [error.details, error.hint, error.code ? `código ${error.code}` : null]
    .filter(Boolean)
    .join(" · ");
  return `Erro ao salvar ${target}: ${error.message}${extra ? ` (${extra})` : ""}`;
}

function logDatabaseFailure(
  requestId: string,
  table: "appointments" | "clients" | "barbers",
  operation: string,
  error: DatabaseFailure | null,
  context: Record<string, string | null>,
) {
  console.error(`[appointment-create] ${table}.${operation} falhou`, {
    request_id: requestId,
    table,
    operation,
    code: error?.code ?? null,
    message: error?.message ?? "A consulta não retornou o registro esperado.",
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    ...context,
  });
}

export const Route = createFileRoute("/api/public/appointment-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();
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

          // Resolve o tenant uma vez, antes das duas gravações. Falhas nessa
          // consulta são registradas, mas não impedem as tentativas abaixo.
          const barberRow = await admin
            .from("barbers")
            .select("barbershop_id")
            .eq("id", d.barber_id)
            .maybeSingle();
          if (barberRow.error || !barberRow.data) {
            logDatabaseFailure(requestId, "barbers", "select", barberRow.error, {
              barber_id: d.barber_id,
            });
          }
          const barbershopId =
            (barberRow.data as { barbershop_id?: string | null } | null)?.barbershop_id ?? null;

          // 1) O agendamento é sempre a primeira gravação e usa diretamente o
          // cliente Admin. O resultado é aguardado e validado antes de continuar.
          const appointmentInsert = await admin
            .from("appointments")
            .insert({
              barber_id: d.barber_id,
              service_id: d.service_id,
              customer_name: d.customer_name.trim(),
              customer_phone: d.customer_phone,
              email: d.email || null,
              appointment_time: appointmentTimeIso,
              status: "confirmado",
              payment_status: "pendente",
              ...(barbershopId ? { barbershop_id: barbershopId } : {}),
            })
            .select("id")
            .maybeSingle();
          const appointmentId = appointmentInsert.data?.id
            ? String(appointmentInsert.data.id)
            : null;
          if (appointmentInsert.error || !appointmentId) {
            logDatabaseFailure(requestId, "appointments", "insert", appointmentInsert.error, {
              barber_id: d.barber_id,
              service_id: d.service_id,
              appointment_time: appointmentTimeIso,
            });
          }

          // 2) A gravação do cliente sempre é tentada, mesmo se appointments
          // falhar. Assim cada tabela tem erro e diagnóstico independentes.
          let clientId: string | null = null;
          let clientFailure: DatabaseFailure | null = null;
          try {
            const existingClient = await admin
              .from("clients")
              .select("id")
              .eq("barber_id", d.barber_id)
              .eq("whatsapp", d.customer_phone)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();
            if (existingClient.error) {
              logDatabaseFailure(requestId, "clients", "select", existingClient.error, {
                barber_id: d.barber_id,
              });
            }

            if (existingClient.data?.id) {
              clientId = String(existingClient.data.id);
              const patch: Record<string, unknown> = {
                name: d.customer_name,
                ...(d.email ? { email: d.email } : {}),
                ...(userId ? { user_id: userId } : {}),
                ...(barbershopId ? { barbershop_id: barbershopId } : {}),
              };
              const updated = await admin
                .from("clients")
                .update(patch)
                .eq("id", clientId)
                .select("id")
                .maybeSingle();
              if (updated.error || !updated.data) {
                clientFailure = updated.error ?? {
                  message: "O banco não retornou o cliente atualizado.",
                };
                clientId = null;
                logDatabaseFailure(requestId, "clients", "update", updated.error, {
                  barber_id: d.barber_id,
                  client_id: String(existingClient.data.id),
                });
              }
            } else {
              const clientInsert = await admin
                .from("clients")
                .insert({
                  barber_id: d.barber_id,
                  name: d.customer_name,
                  email: d.email || null,
                  whatsapp: d.customer_phone,
                  user_id: userId,
                  ...(barbershopId ? { barbershop_id: barbershopId } : {}),
                })
                .select("id")
                .maybeSingle();
              if (clientInsert.error || !clientInsert.data) {
                clientFailure = clientInsert.error ?? {
                  message: "O banco não retornou o cliente inserido.",
                };
                logDatabaseFailure(requestId, "clients", "insert", clientInsert.error, {
                  barber_id: d.barber_id,
                });
              }
              clientId = clientInsert.data?.id ? String(clientInsert.data.id) : null;
            }
          } catch (clientError) {
            clientFailure = {
              message: clientError instanceof Error ? clientError.message : String(clientError),
            };
            logDatabaseFailure(requestId, "clients", "write", clientFailure, {
              barber_id: d.barber_id,
            });
          }

          if (!appointmentId) {
            const failure = appointmentInsert.error ?? {
              message: "O banco não retornou o ID do agendamento.",
            };
            return json({
              error: databaseError(failure, "agendamento"),
              appointment_persisted: false,
              client_persisted: Boolean(clientId),
              request_id: requestId,
            }, 500);
          }

          if (!clientId) {
            return json({
              id: appointmentId,
              error: databaseError(
                clientFailure ?? { message: "O banco não confirmou a gravação do cliente." },
                "cliente",
              ),
              appointment_persisted: true,
              client_persisted: false,
              persisted: false,
              request_id: requestId,
            }, 500);
          }

          return json({
            id: appointmentId,
            client_id: clientId,
            persisted: true,
            appointment_persisted: true,
            client_persisted: true,
            request_id: requestId,
          });

        } catch (error) {
          console.error("[appointment-create] erro inesperado", { request_id: requestId, error });
          const message = error instanceof Error ? error.message : String(error);
          return json({ error: `Erro ao salvar agendamento: ${message}` }, 500);
        }
      },
    },
  },
});

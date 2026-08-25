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
          let appointmentId: string | null = created.data ? String(created.data) : null;

          // barbershop_id do barbeiro: usado tanto no fallback do agendamento
          // quanto na gravação do cliente (isolamento multi-tenant).
          const barberRow = await admin
            .from("barbers")
            .select("barbershop_id")
            .eq("id", d.barber_id)
            .maybeSingle();
          const barbershopId =
            (barberRow.data as { barbershop_id?: string | null } | null)?.barbershop_id ?? null;

          if (created.error || !appointmentId) {
            console.error("[appointment-create] RPC falhou", {
              args: { ...rpcArgs, p_customer_phone: `${d.customer_phone.slice(0, 4)}***` },
              message: created.error?.message,
              details: created.error?.details,
              hint: created.error?.hint,
              code: created.error?.code,
            });

            // Fallback: a função pode não existir no banco (42883/PGRST202) ou
            // não ter retornado id. Grava direto com service role para que o
            // agendamento nunca se perca.
            const inserted = await admin
              .from("appointments")
              .insert({
                barber_id: d.barber_id,
                service_id: d.service_id,
                customer_name: d.customer_name,
                customer_phone: d.customer_phone,
                email: d.email || null,
                appointment_time: appointmentTimeIso,
                status: "confirmado",
                payment_status: "pendente",
                ...(barbershopId ? { barbershop_id: barbershopId } : {}),
              })
              .select("id")
              .maybeSingle();

            if (inserted.error || !inserted.data) {
              console.error("[appointment-create] insert de fallback falhou", inserted.error);
              return json(
                {
                  error: created.error
                    ? databaseError(created.error)
                    : inserted.error
                      ? databaseError(inserted.error)
                      : "Erro ao salvar agendamento: a transação não retornou o registro criado.",
                },
                500,
              );
            }

            appointmentId = String((inserted.data as { id: string }).id);
          }

          // Cliente sempre garantido — independente de a RPC ter funcionado.
          // Se já existe (mesmo barbeiro + WhatsApp), atualiza nome/e-mail/vínculos.
          let clientId: string | null = null;
          try {
            const existingClient = await admin
              .from("clients")
              .select("id")
              .eq("barber_id", d.barber_id)
              .eq("whatsapp", d.customer_phone)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();

            if (existingClient.data?.id) {
              clientId = String(existingClient.data.id);
              const patch: Record<string, unknown> = {
                name: d.customer_name,
                ...(d.email ? { email: d.email } : {}),
                ...(userId ? { user_id: userId } : {}),
                ...(barbershopId ? { barbershop_id: barbershopId } : {}),
              };
              const updated = await admin.from("clients").update(patch).eq("id", clientId);
              if (updated.error) {
                console.error("[appointment-create] update de cliente falhou", updated.error);
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
              if (clientInsert.error) {
                console.error("[appointment-create] insert de cliente falhou", clientInsert.error);
              }
              clientId = clientInsert.data?.id ? String(clientInsert.data.id) : null;
            }
          } catch (clientError) {
            console.error("[appointment-create] erro ao gravar cliente", clientError);
          }

          // Confirma o agendamento antes de autorizar qualquer navegação.
          const persistedAppointment = await admin
            .from("appointments")
            .select("id, payment_status, barber_id, customer_phone")
            .eq("id", appointmentId)
            .maybeSingle();
          if (persistedAppointment.error || !persistedAppointment.data) {
            console.error(
              "[appointment-create] confirmação do agendamento falhou",
              persistedAppointment.error,
            );
            return json({ error: "Erro ao salvar agendamento: o banco não confirmou a gravação." }, 500);
          }

          if (!clientId) {
            const recheck = await admin
              .from("clients")
              .select("id")
              .eq("barber_id", d.barber_id)
              .eq("whatsapp", d.customer_phone)
              .limit(1)
              .maybeSingle();
            clientId = recheck.data?.id ? String(recheck.data.id) : null;
          }

          return json({
            id: appointmentId,
            client_id: clientId,
            persisted: true,
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

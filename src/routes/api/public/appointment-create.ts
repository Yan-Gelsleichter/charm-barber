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

          const [barberResult, serviceResult] = await Promise.all([
            admin.from("barbers").select("id, barbershop_id").eq("id", d.barber_id).maybeSingle(),
            admin
              .from("services")
              .select("id, barber_id, barbershop_id")
              .eq("id", d.service_id)
              .maybeSingle(),
          ]);
          const barber = barberResult.data;
          const service = serviceResult.data;
          if (
            barberResult.error ||
            serviceResult.error ||
            !barber ||
            !service ||
            (service.barber_id && service.barber_id !== d.barber_id) ||
            (service.barbershop_id && service.barbershop_id !== barber.barbershop_id)
          ) {
            return json({ error: "Erro ao salvar agendamento: barbeiro ou serviço inválido." }, 400);
          }

          // O agendamento é a escrita principal. A resposta positiva depende
          // somente desta inserção retornar a linha realmente persistida.
          const created = await admin
            .from("appointments")
            .insert({
              barber_id: d.barber_id,
              service_id: d.service_id,
              customer_name: d.customer_name.trim(),
              customer_phone: d.customer_phone,
              email: d.email?.trim().toLowerCase() || null,
              appointment_time: appointmentTimeIso,
              status: "confirmado",
              payment_status: "pendente",
              barbershop_id: barber.barbershop_id,
            })
            .select(
              "id, barber_id, service_id, customer_name, customer_phone, appointment_time, payment_status",
            )
            .single();

          if (created.error || !created.data) {
            console.error("[appointment-create] insert de appointments falhou", {
              barberId: d.barber_id,
              serviceId: d.service_id,
              appointmentTime: appointmentTimeIso,
              message: created.error?.message,
              details: created.error?.details,
              hint: created.error?.hint,
              code: created.error?.code,
            });
            return json(
              {
                error: created.error
                  ? databaseError(created.error)
                  : "Erro ao salvar agendamento: o banco não retornou o registro criado.",
              },
              500,
            );
          }

          const savedAppointment = created.data;
          const savedTime = new Date(savedAppointment.appointment_time).getTime();
          if (
            savedAppointment.customer_phone !== d.customer_phone ||
            savedAppointment.customer_name.trim() !== d.customer_name.trim() ||
            savedAppointment.barber_id !== d.barber_id ||
            savedAppointment.service_id !== d.service_id ||
            savedTime !== parsedTime.getTime()
          ) {
            console.error("[appointment-create] appointment confirmado diverge da solicitação", {
              appointmentId: savedAppointment.id,
              expectedTime: appointmentTimeIso,
              savedTime: savedAppointment.appointment_time,
              phoneMatches: savedAppointment.customer_phone === d.customer_phone,
              nameMatches: savedAppointment.customer_name.trim() === d.customer_name.trim(),
            });
            return json(
              { error: "Erro ao salvar agendamento: o registro gravado não foi confirmado." },
              500,
            );
          }

          // A ficha do cliente é sincronizada depois e de forma independente.
          // Uma falha aqui é registrada para diagnóstico, mas nunca desfaz nem
          // bloqueia um horário que já foi confirmado em appointments.
          const existingClient = await admin
            .from("clients")
            .select("id")
            .eq("barber_id", d.barber_id)
            .eq("whatsapp", d.customer_phone)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          const clientValues = {
            barber_id: d.barber_id,
            name: d.customer_name.trim(),
            whatsapp: d.customer_phone,
            email: d.email?.trim().toLowerCase() || null,
            user_id: userId,
            barbershop_id: barber.barbershop_id,
          };
          const clientWrite = existingClient.data?.id
            ? await admin.from("clients").update(clientValues).eq("id", existingClient.data.id).select("id").single()
            : await admin.from("clients").insert(clientValues).select("id").single();
          if (existingClient.error || clientWrite.error) {
            console.warn("[appointment-create] agendamento salvo; sincronização do cliente falhou", {
              appointmentId: savedAppointment.id,
              lookupError: existingClient.error?.message,
              writeError: clientWrite.error?.message,
            });
          }
          const savedClientId = clientWrite.data?.id ? String(clientWrite.data.id) : null;

          return json({
            id: String(savedAppointment.id),
            client_id: savedClientId,
            client_synced: Boolean(savedClientId),
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

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

          // Uma única função SQL cria o agendamento e o cliente na mesma
          // transação. Qualquer falha desfaz ambos antes de devolver a resposta.
          const created = await admin.rpc("create_appointment_with_client", {
            p_barber_id: d.barber_id,
            p_service_id: d.service_id,
            p_customer_name: d.customer_name,
            p_customer_phone: d.customer_phone,
            p_email: d.email ?? "",
            p_appointment_time: d.appointment_time,
            p_user_id: userId,
          });
          if (created.error || !created.data) {
            console.error("[appointment-create] transação falhou", created.error);
            return json(
              {
                error: created.error
                  ? databaseError(created.error)
                  : "Erro ao salvar agendamento: a transação não retornou o registro criado.",
              },
              500,
            );
          }

          const appointmentId = String(created.data);
          // Confirma os dois lados da transação antes de autorizar qualquer
          // navegação. A função SQL sempre normaliza o telefone do cliente para
          // o mesmo valor recebido aqui, inclusive quando atualiza um cadastro.
          const [persistedAppointment, persistedClient] = await Promise.all([
            admin
              .from("appointments")
              .select("id, payment_status, barber_id, customer_phone")
              .eq("id", appointmentId)
              .eq("barber_id", d.barber_id)
              .eq("customer_phone", d.customer_phone)
              .maybeSingle(),
            admin
              .from("clients")
              .select("id, barber_id, whatsapp")
              .eq("barber_id", d.barber_id)
              .eq("whatsapp", d.customer_phone)
              .maybeSingle(),
          ]);
          if (persistedAppointment.error || !persistedAppointment.data) {
            console.error(
              "[appointment-create] confirmação do agendamento falhou",
              persistedAppointment.error,
            );
            return json({ error: "Erro ao salvar agendamento: o banco não confirmou a gravação." }, 500);
          }
          if (persistedClient.error || !persistedClient.data) {
            console.error(
              "[appointment-create] confirmação do cliente falhou",
              persistedClient.error,
            );
            return json({ error: "Erro ao salvar agendamento: o banco não confirmou o cadastro do cliente." }, 500);
          }

          return json({
            id: appointmentId,
            client_id: persistedClient.data.id,
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

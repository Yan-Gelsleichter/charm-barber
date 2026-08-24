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
  customer_phone: z.string().transform(val => val.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8,15}$/)),
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

          const created = await admin.rpc("create_appointment_with_client", {
            p_barber_id: d.barber_id,
            p_service_id: d.service_id,
            p_customer_name: d.customer_name,
            p_customer_phone: d.customer_phone,
            p_email: d.email ?? "",
            p_appointment_time: d.appointment_time,
            p_user_id: userId,
          });
          
          if (created.error) {
            return json({ error: `Erro do Banco: ${JSON.stringify(created.error)}` }, 500);
          }
          if (!created.data) {
            return json({ error: "Erro: A função retornou vazio." }, 500);
          }

          const appointmentId = String(created.data);

      const persistedAppointment = await admin
        .from("appointments")
        .select("id")
        .eq("id", appointmentId)
        .maybeSingle();

      if (persistedAppointment.error) {
        return json({ error: `Erro no Select: ${JSON.stringify(persistedAppointment.error)}` }, 500);
      }
      if (!persistedAppointment.data) {
        return json({ error: "Erro: O ID retornado pela função não foi encontrado na tabela appointments." }, 500);
      }

      return json({
        id: appointmentId,
        client_id: appointmentId,
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

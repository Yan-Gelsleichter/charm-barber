import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

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

export const Route = createFileRoute("/api/public/appointment-create")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const rawBody = await request.json().catch(() => null);
          const parsed = requestSchema.safeParse(rawBody);
          if (!parsed.success) {
            const reason = parsed.error.issues[0]?.message ?? "dados inválidos";
            return json({ error: `Erro ao salvar agendamento: ${reason}` }, 400);
          }

          const admin = createSupabaseAdmin();
          if (!admin) {
            return json({ error: "Erro ao salvar agendamento: serviço indisponível." }, 503);
          }

          const d = parsed.data;
          const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
          let userId: string | null = null;
          if (bearer) {
            const { data: authData } = await admin.auth.getUser(bearer);
            userId = authData?.user?.id ?? null;
          }

          // Executa a função transacional no banco
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
            console.error("[appointment-create] erro na rpc", created.error);
            return json({ error: `Erro ao salvar agendamento: ${created.error?.message ?? "Falha na transação"}` }, 500);
          }

          const appointmentId = String(created.data);

          // Confirma apenas pelo ID para evitar erros de colunas inexistentes
          const persisted = await admin
            .from("appointments")
            .select("id")
            .eq("id", appointmentId)
            .maybeSingle();

          if (persisted.error || !persisted.data) {
            console.error("[appointment-create] erro na confirmação", persisted.error);
            return json({ error: `Erro de confirmação: ${persisted.error?.message ?? "Registro não encontrado"}` }, 500);
          }

          // Busca o ID do cliente recém-criado ou atualizado para retornar ao front
          const clientQuery = await admin
            .from("clients")
            .select("id")
            .eq("barber_id", d.barber_id)
            .eq("whatsapp", d.customer_phone)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          return json({
            id: appointmentId,
            client_id: clientQuery.data?.id ?? appointmentId,
            persisted: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json({ error: `Erro ao salvar agendamento: ${message}` }, 500);
        }
      },
    },
  },
});
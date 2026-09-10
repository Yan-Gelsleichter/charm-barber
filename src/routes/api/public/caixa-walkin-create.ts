import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Cria um atendimento avulso (presencial, registrado direto pelo admin no
 * balcão, sem passar pelo app). Já nasce "pago" e marcado is_walk_in=true —
 * não conta como horário ocupado pra ninguém (ver docs/fix-availability-rpc.sql
 * e src/lib/availability.ts). barbershop_id vem sempre do admin logado, nunca
 * do corpo da requisição.
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  service_id: z.string().uuid(),
  customer_name: z.string().trim().min(1).max(120),
  price: z.number().nonnegative(),
  appointment_time: z.string().min(1),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-walkin-create")({
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

          const { data: targetBarber } = await admin
            .from("barbers")
            .select("id, barbershop_id")
            .eq("id", parsed.data.barber_id)
            .maybeSingle();
          if (
            !targetBarber ||
            (targetBarber as { barbershop_id?: string | null }).barbershop_id !== barbershopId
          ) {
            return json({ error: "Barbeiro não pertence a essa barbearia." }, 400);
          }

          const { data: targetService } = await admin
            .from("services")
            .select("id, barber_id")
            .eq("id", parsed.data.service_id)
            .maybeSingle();
          if (
            !targetService ||
            (targetService as { barber_id?: string | null }).barber_id !== parsed.data.barber_id
          ) {
            return json({ error: "Serviço não pertence a esse barbeiro." }, 400);
          }

          const appointmentTime = new Date(parsed.data.appointment_time);
          if (Number.isNaN(appointmentTime.getTime())) {
            return json({ error: "Data/hora inválida." }, 400);
          }

          const inserted = await admin
            .from("appointments")
            .insert({
              barber_id: parsed.data.barber_id,
              service_id: parsed.data.service_id,
              barbershop_id: barbershopId,
              customer_name: parsed.data.customer_name,
              customer_phone: "",
              appointment_time: appointmentTime.toISOString(),
              status: "confirmado",
              payment_status: "pago",
              payment_method: "presencial",
              paid_at: new Date().toISOString(),
              service_price_snapshot: parsed.data.price,
              is_walk_in: true,
            })
            .select("*")
            .maybeSingle();
          if (inserted.error || !inserted.data) {
            console.error("[caixa-walkin-create] falha ao inserir", inserted.error);
            return json({ error: "Não foi possível registrar o atendimento." }, 500);
          }

          return json({ ok: true, appointment: inserted.data });
        } catch (error) {
          console.error("[caixa-walkin-create] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

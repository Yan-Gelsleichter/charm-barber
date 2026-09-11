import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Corrige um atendimento avulso já lançado (nome/valor/horário/barbeiro/
 * serviço errado) sem precisar excluir e recriar. Só atua em linhas com
 * is_walk_in=true — nunca em agendamentos de verdade vindos do app, mesmo
 * que o appointment_id seja forçado.
 */

const requestSchema = z.object({
  appointment_id: z.string().uuid(),
  barber_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()).min(1),
  customer_name: z.string().trim().min(1).max(120),
  price: z.number().nonnegative(),
  appointment_time: z.string().min(1),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-walkin-update")({
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

          const found = await admin
            .from("appointments")
            .select("id, barbershop_id, is_walk_in")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          const row = found.data as
            | { id: string; barbershop_id?: string | null; is_walk_in?: boolean | null }
            | null;
          if (found.error || !row) return json({ error: "Atendimento não encontrado." }, 404);
          if (row.barbershop_id !== barbershopId) {
            return json({ error: "Esse atendimento não é dessa barbearia." }, 403);
          }
          if (!row.is_walk_in) {
            return json({ error: "Só é possível editar atendimentos avulsos." }, 400);
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

          const { data: targetServicesData } = await admin
            .from("services")
            .select("id, barber_id, duration_minutes")
            .in("id", parsed.data.service_ids);
          const targetServices = (targetServicesData ?? []) as {
            id: string;
            barber_id: string | null;
            duration_minutes: number | null;
          }[];
          const allServicesValid =
            targetServices.length === parsed.data.service_ids.length &&
            targetServices.every((s) => s.barber_id === parsed.data.barber_id);
          if (!allServicesValid) {
            return json({ error: "Serviço não pertence a esse barbeiro." }, 400);
          }

          const appointmentTime = new Date(parsed.data.appointment_time);
          if (Number.isNaN(appointmentTime.getTime())) {
            return json({ error: "Data/hora inválida." }, 400);
          }

          const totalDuration = targetServices.reduce(
            (sum, s) => sum + Number(s.duration_minutes ?? 30),
            0,
          );

          const updated = await admin
            .from("appointments")
            .update({
              barber_id: parsed.data.barber_id,
              service_id: parsed.data.service_ids[0],
              service_ids: parsed.data.service_ids,
              customer_name: parsed.data.customer_name,
              appointment_time: appointmentTime.toISOString(),
              service_price_snapshot: parsed.data.price,
              duration_minutes_snapshot: totalDuration,
            })
            .eq("id", parsed.data.appointment_id)
            .eq("is_walk_in", true)
            .select("*")
            .maybeSingle();
          if (updated.error || !updated.data) {
            console.error("[caixa-walkin-update] falha ao atualizar", updated.error);
            return json({ error: "Não foi possível corrigir o atendimento." }, 500);
          }

          return json({ ok: true, appointment: updated.data });
        } catch (error) {
          console.error("[caixa-walkin-update] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});

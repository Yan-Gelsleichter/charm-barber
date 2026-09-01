import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { sendPush } from "@/lib/push.server";

/**
 * Roda periodicamente (Vercel Cron, ver vercel.json) e manda dois lembretes
 * independentes: pro cliente (usa o push_token salvo no próprio
 * agendamento) e pro barbeiro, 30 minutos antes (usa os tokens salvos em
 * push_subscriptions). Cada um marca sua própria coluna pra nunca repetir.
 */

const CLIENT_REMINDER_MINUTES = 60;
const BARBER_REMINDER_MINUTES = 30;
const WINDOW_MINUTES = 10; // margem pra cobrir o intervalo entre execuções do cron

function windowAround(minutesAhead: number) {
  const now = Date.now();
  const start = new Date(now + (minutesAhead - WINDOW_MINUTES / 2) * 60_000);
  const end = new Date(now + (minutesAhead + WINDOW_MINUTES / 2) * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

type AppointmentRow = {
  id: string;
  barber_id: string;
  service_id: string;
  customer_name: string;
  appointment_time: string;
};

export const Route = createFileRoute("/api/cron/appointment-reminders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env["CRON_SECRET"];
        if (cronSecret) {
          const authorization = request.headers.get("authorization") ?? "";
          if (authorization !== `Bearer ${cronSecret}`) {
            return new Response("unauthorized", { status: 401 });
          }
        }

        const admin = createSupabaseAdmin();
        if (!admin) return new Response("misconfigured", { status: 500 });

        const [clientResult, barberResult] = await Promise.all([
          remindClients(admin),
          remindBarbers(admin),
        ]);

        return Response.json({
          client_reminders_sent: clientResult,
          barber_reminders_sent: barberResult,
        });
      },
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function remindClients(admin: any): Promise<number> {
  const { start, end } = windowAround(CLIENT_REMINDER_MINUTES);
  const { data, error } = await admin
    .from("appointments")
    .select("id, barber_id, service_id, customer_name, appointment_time, push_token")
    .eq("status", "confirmado")
    .is("reminder_sent_at", null)
    .not("push_token", "is", null)
    .gte("appointment_time", start)
    .lte("appointment_time", end);
  if (error || !data?.length) return 0;

  const rows = data as (AppointmentRow & { push_token: string })[];
  const serviceIds = Array.from(new Set(rows.map((r) => r.service_id)));
  const { data: services } = await admin.from("services").select("id, name").in("id", serviceIds);
  const serviceNameById = new Map(((services ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  let sent = 0;
  for (const row of rows) {
    await sendPush([row.push_token], {
      title: "Seu horário está chegando",
      body: `${serviceNameById.get(row.service_id) ?? "Seu atendimento"} às ${new Date(row.appointment_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
      url: "/meus-agendamentos",
    });
    sent += 1;
    await admin.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", row.id);
  }
  return sent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function remindBarbers(admin: any): Promise<number> {
  const { start, end } = windowAround(BARBER_REMINDER_MINUTES);
  const { data, error } = await admin
    .from("appointments")
    .select("id, barber_id, service_id, customer_name, appointment_time")
    .eq("status", "confirmado")
    .is("barber_reminder_sent_at", null)
    .gte("appointment_time", start)
    .lte("appointment_time", end);
  if (error || !data?.length) return 0;

  const rows = data as AppointmentRow[];
  const barberIds = Array.from(new Set(rows.map((r) => r.barber_id)));
  const serviceIds = Array.from(new Set(rows.map((r) => r.service_id)));
  const [{ data: subs }, { data: services }] = await Promise.all([
    admin.from("push_subscriptions").select("barber_id, token").in("barber_id", barberIds),
    admin.from("services").select("id, name").in("id", serviceIds),
  ]);
  const serviceNameById = new Map(((services ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const tokensByBarber = new Map<string, string[]>();
  for (const sub of (subs ?? []) as { barber_id: string; token: string }[]) {
    if (!tokensByBarber.has(sub.barber_id)) tokensByBarber.set(sub.barber_id, []);
    tokensByBarber.get(sub.barber_id)!.push(sub.token);
  }

  let sent = 0;
  for (const row of rows) {
    const tokens = tokensByBarber.get(row.barber_id) ?? [];
    if (tokens.length > 0) {
      const { invalidTokens } = await sendPush(tokens, {
        title: "Atendimento em 30 minutos",
        body: `${row.customer_name} · ${serviceNameById.get(row.service_id) ?? "atendimento"} às ${new Date(row.appointment_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        url: "/painel",
      });
      if (invalidTokens.length > 0) {
        await admin.from("push_subscriptions").delete().in("token", invalidTokens);
      }
      sent += 1;
    }
    await admin
      .from("appointments")
      .update({ barber_reminder_sent_at: new Date().toISOString() })
      .eq("id", row.id);
  }
  return sent;
}

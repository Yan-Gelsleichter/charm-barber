import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, DollarSign, TrendingUp, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { brl, fmtTime } from "@/lib/format";
import { filterActiveAppointments, hideRejectedPayments } from "@/lib/availability";
import { PaymentBadge } from "@/components/PaymentBadge";

export function DashboardTab({ barber }: { barber: Barber }) {
  const q = useQuery({
    queryKey: ["dash", barber.id],
    refetchInterval: 20_000,
    queryFn: async () => {

      const monthAgo = new Date();
      monthAgo.setDate(monthAgo.getDate() - 31);
      const [agRes, svRes] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("barber_id", barber.id)
          .gte("appointment_time", monthAgo.toISOString())
          .order("appointment_time"),
        supabase.from("services").select("*").eq("barber_id", barber.id),
      ]);
      if (agRes.error) throw agRes.error;
      if (svRes.error) throw svRes.error;
      return {
        appointments: agRes.data as Appointment[],
        services: svRes.data as Service[],
      };
    },
  });

  const now = new Date();
  const startDay = new Date(now);
  startDay.setHours(0, 0, 0, 0);
  const startWeek = new Date(startDay);
  startWeek.setDate(startWeek.getDate() - startWeek.getDay());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const priceMap = new Map((q.data?.services ?? []).map((s) => [s.id, Number(s.price)]));
  const appointments = hideRejectedPayments(
    filterActiveAppointments(q.data?.appointments ?? []),
  );

  const sum = (from: Date) =>
    appointments
      .filter(
        (a) =>
          new Date(a.appointment_time) >= from &&
          new Date(a.appointment_time) <= now,
      )
      .reduce((s, a) => s + (priceMap.get(a.service_id) ?? 0), 0);

  const ganhosDia = sum(startDay);
  const ganhosSemana = sum(startWeek);
  const ganhosMes = sum(startMonth);

  const startTomorrow = new Date(startDay);
  startTomorrow.setDate(startTomorrow.getDate() + 1);

  const hoje = appointments.filter((a) => {
    const t = new Date(a.appointment_time);
    return t >= startDay && t < startTomorrow;
  });

  const proximos = appointments
    .filter((a) => new Date(a.appointment_time) >= startTomorrow)
    .slice(0, 5);

  const clientesUnicos = new Set(appointments.map((a) => a.customer_phone)).size;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat icon={DollarSign} label="Hoje" value={brl(ganhosDia)} />
        <Stat icon={TrendingUp} label="Esta semana" value={brl(ganhosSemana)} />
        <Stat icon={CalendarCheck} label="Este mês" value={brl(ganhosMes)} />
        <Stat icon={Users} label="Clientes (30d)" value={String(clientesUnicos)} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Agendamentos de hoje
        </h2>
        {hoje.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Sem agendamentos hoje.
          </div>
        ) : (
          <div className="grid gap-2">
            {hoje.map((a) => {
              const sv = q.data?.services.find((s) => s.id === a.service_id);
              const fim =
                new Date(a.appointment_time).getTime() +
                (sv?.duration_minutes ?? 30) * 60_000;
              const atendido = fim <= now.getTime();
              return (
                <div
                  key={a.id}
                  className={`surface flex items-center justify-between p-4 ${atendido ? "opacity-70" : ""}`}
                >
                  <div>
                    <p className="font-semibold">{a.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sv?.name ?? "Serviço"} · {fmtTime(a.appointment_time)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaymentBadge status={a.payment_status} compact />
                    {atendido && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        Atendido
                      </span>
                    )}
                    <span className="brand-text font-bold">{sv ? brl(sv.price) : "—"}</span>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Próximos agendamentos
        </h2>
        {proximos.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Sem agendamentos futuros.
          </div>
        ) : (
          <div className="grid gap-2">
            {proximos.map((a) => {
              const sv = q.data?.services.find((s) => s.id === a.service_id);
              return (
                <div key={a.id} className="surface flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{a.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sv?.name ?? "Serviço"} ·{" "}
                      {new Date(a.appointment_time).toLocaleDateString("pt-BR")} ·{" "}
                      {fmtTime(a.appointment_time)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaymentBadge status={a.payment_status} compact />
                    <span className="brand-text font-bold">{sv ? brl(sv.price) : "—"}</span>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" /> {label}
      </div>
      <p className="mt-2 text-xl font-bold sm:text-2xl">{value}</p>
    </div>
  );
}

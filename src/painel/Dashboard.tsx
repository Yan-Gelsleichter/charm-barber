import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, DollarSign, TrendingUp, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { brl, fmtTime } from "@/lib/format";
import { BRAZIL_TIME_ZONE, brazilStartOfDay, brazilStartOfWeek, brazilStartOfMonth } from "@/lib/timezone";
import { filterActiveAppointments, hideRejectedPayments } from "@/lib/availability";
import { PaymentBadge } from "@/components/PaymentBadge";
import { useDirectAppointments } from "@/hooks/use-direct-appointments";

export function DashboardTab({ barber }: { barber: Barber }) {
  // Calculado uma única vez por montagem: se recalculado a cada render (new Date()
  // direto no corpo do componente), a string ISO muda a cada milissegundo e recria
  // o efeito dentro de useDirectAppointments, causando um loop de refetch infinito.
  const monthAgoIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 31);
    return d.toISOString();
  }, []);
  const directAppointments = useDirectAppointments({
    barberId: barber.id,
    from: monthAgoIso,
  });
  const q = useQuery({
    queryKey: ["dash-services", barber.id],
    refetchInterval: 20_000,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: async () => {

      const svRes = await supabase.from("services").select("*").eq("barber_id", barber.id);
      if (svRes.error) throw svRes.error;
      return svRes.data as Service[];
    },
  });

  const now = new Date();
  // "Hoje/semana/mês" sempre pelo calendário de Brasília, não pelo fuso do
  // aparelho de quem está olhando o painel.
  const startDay = brazilStartOfDay(now);
  const startWeek = brazilStartOfWeek(now);
  const startMonth = brazilStartOfMonth(now);

  // Mantém os últimos serviços na tela enquanto uma atualização em segundo
  // plano está em andamento — zerar aqui fazia os valores (Hoje/Semana/Mês)
  // e a lista de agendamentos piscarem a cada atualização automática.
  const freshServices = q.data ?? [];
  const priceMap = new Map(freshServices.map((s) => [s.id, Number(s.price)]));
  const appointments = hideRejectedPayments(
    filterActiveAppointments(directAppointments.appointments ?? []),
  );

  // Usa o preço travado no momento do agendamento; só cai para o preço
  // atual do serviço em agendamentos antigos que não têm esse valor salvo.
  const sum = (from: Date) =>
    appointments
      .filter(
        (a) =>
          new Date(a.appointment_time) >= from &&
          new Date(a.appointment_time) <= now,
      )
      .reduce((s, a) => s + (a.service_price_snapshot ?? priceMap.get(a.service_id) ?? 0), 0);

  const ganhosDia = sum(startDay);
  const ganhosSemana = sum(startWeek);
  const ganhosMes = sum(startMonth);

  const startTomorrow = new Date(startDay.getTime() + 86_400_000);

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
          <div className="grid grid-cols-1 gap-2">
            {hoje.map((a) => {
              const sv = freshServices.find((s) => s.id === a.service_id);
              const preco = a.service_price_snapshot ?? sv?.price ?? null;
              const fim =
                new Date(a.appointment_time).getTime() +
                (sv?.duration_minutes ?? 30) * 60_000;
              const atendido = fim <= now.getTime();
              return (
                <div
                  key={a.id}
                  className={`surface flex flex-col gap-2 p-4 ${atendido ? "opacity-70" : ""}`}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{a.customer_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {sv?.name ?? "Serviço"} · {fmtTime(a.appointment_time)}
                      </p>
                    </div>
                    <span className="brand-text shrink-0 font-bold">
                      {preco != null ? brl(preco) : "—"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentBadge status={a.payment_status} compact />
                    {atendido && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        Atendido
                      </span>
                    )}
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
          <div className="grid grid-cols-1 gap-2">
            {proximos.map((a) => {
              const sv = freshServices.find((s) => s.id === a.service_id);
              const preco = a.service_price_snapshot ?? sv?.price ?? null;
              return (
                <div key={a.id} className="surface flex flex-col gap-2 p-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{a.customer_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {sv?.name ?? "Serviço"} ·{" "}
                        {new Date(a.appointment_time).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })} ·{" "}
                        {fmtTime(a.appointment_time)}
                      </p>
                    </div>
                    <span className="brand-text shrink-0 font-bold">
                      {preco != null ? brl(preco) : "—"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentBadge status={a.payment_status} compact />
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

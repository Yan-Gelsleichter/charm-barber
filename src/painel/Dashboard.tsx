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

  // Agrupa "serviço extra" (is_walk_in=true + parent_appointment_id) junto
  // do agendamento original, em vez de aparecer como um card separado —
  // mesmo padrão já usado na aba Caixa.
  const topLevel = appointments.filter((a) => !a.parent_appointment_id);
  const topLevelIds = new Set(topLevel.map((a) => a.id));
  const childrenByParent = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (a.parent_appointment_id && topLevelIds.has(a.parent_appointment_id)) {
      const list = childrenByParent.get(a.parent_appointment_id) ?? [];
      list.push(a);
      childrenByParent.set(a.parent_appointment_id, list);
    }
  }
  // Se por algum motivo o "pai" não estiver na lista, mostra o extra normal.
  const orphanExtras = appointments.filter(
    (a) => a.parent_appointment_id && !topLevelIds.has(a.parent_appointment_id),
  );
  const topLevelAppointments = [...topLevel, ...orphanExtras];

  function serviceLineItems(x: Appointment): { id: string; name: string; price: number }[] {
    const ids = x.service_ids?.length ? x.service_ids : [x.service_id];
    return ids.map((id) => {
      const sv = freshServices.find((s) => s.id === id);
      return { id, name: sv?.name ?? "Serviço removido", price: sv?.price ?? 0 };
    });
  }
  function valorDe(x: Appointment) {
    return x.service_price_snapshot ?? freshServices.find((s) => s.id === x.service_id)?.price ?? 0;
  }

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

  const hoje = topLevelAppointments.filter((a) => {
    const t = new Date(a.appointment_time);
    return t >= startDay && t < startTomorrow;
  });

  const proximos = topLevelAppointments
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
              const kids = childrenByParent.get(a.id) ?? [];
              const duracao =
                a.duration_minutes_snapshot ??
                freshServices
                  .filter((s) => (a.service_ids?.length ? a.service_ids : [a.service_id]).includes(s.id))
                  .reduce((sum, s) => sum + s.duration_minutes, 0) ??
                30;
              const fim = new Date(a.appointment_time).getTime() + duracao * 60_000;
              const atendido = fim <= now.getTime();
              const total = valorDe(a) + kids.reduce((sum, k) => sum + valorDe(k), 0);
              const items = [...serviceLineItems(a), ...kids.flatMap((k) => serviceLineItems(k))];
              return (
                <div
                  key={a.id}
                  className={`surface flex flex-col gap-2 p-4 ${atendido ? "opacity-70" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-semibold">{a.customer_name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtTime(a.appointment_time)}</span>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border/60 text-xs">
                    <div className="divide-y divide-border/40">
                      {items.map((item, i) => (
                        <div key={`${a.id}:${item.id}:${i}`} className="flex items-center justify-between px-3 py-1.5">
                          <span className={`min-w-0 truncate ${i > 0 ? "text-muted-foreground" : ""}`}>
                            {i > 0 ? "+ " : ""}
                            {item.name}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{brl(item.price)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between bg-[color:var(--brand-from)]/10 px-3 py-1.5">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold tabular-nums">{brl(total)}</span>
                    </div>
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
              const kids = childrenByParent.get(a.id) ?? [];
              const total = valorDe(a) + kids.reduce((sum, k) => sum + valorDe(k), 0);
              const items = [...serviceLineItems(a), ...kids.flatMap((k) => serviceLineItems(k))];
              return (
                <div key={a.id} className="surface flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-semibold">{a.customer_name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(a.appointment_time).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })} ·{" "}
                      {fmtTime(a.appointment_time)}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border/60 text-xs">
                    <div className="divide-y divide-border/40">
                      {items.map((item, i) => (
                        <div key={`${a.id}:${item.id}:${i}`} className="flex items-center justify-between px-3 py-1.5">
                          <span className={`min-w-0 truncate ${i > 0 ? "text-muted-foreground" : ""}`}>
                            {i > 0 ? "+ " : ""}
                            {item.name}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{brl(item.price)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between bg-[color:var(--brand-from)]/10 px-3 py-1.5">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold tabular-nums">{brl(total)}</span>
                    </div>
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

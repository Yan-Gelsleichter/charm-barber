import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { brl, fmtDateTime } from "@/lib/format";
import { filterActiveAppointments, hideRejectedPayments, isCancellationMarker } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { PaymentBadge } from "@/components/PaymentBadge";

type Periodo = "semana" | "mes" | "ano";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "semana", label: "Semanal" },
  { key: "mes", label: "Mensal" },
  { key: "ano", label: "Anual" },
];

function inicioDoPeriodo(p: Periodo): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "semana") {
    d.setDate(d.getDate() - d.getDay());
  } else if (p === "mes") {
    d.setDate(1);
  } else {
    d.setMonth(0, 1);
  }
  return d;
}

export function HistoricoTab({ barber }: { barber: Barber }) {
  const q = useQuery({
    queryKey: ["historico", barber.id],
    queryFn: async () => {
      const now = new Date().toISOString();
      const [a, s] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("barber_id", barber.id)
          .lt("appointment_time", now)
          .order("appointment_time", { ascending: false })
          .limit(100),
        supabase.from("services").select("*").eq("barber_id", barber.id),
      ]);
      if (a.error) throw a.error;
      if (s.error) throw s.error;
      return { ag: a.data as Appointment[], sv: s.data as Service[] };
    },
  });

  const [periodo, setPeriodo] = useState<Periodo>("semana");

  const svMap = new Map((q.data?.sv ?? []).map((s) => [s.id, s]));
  const todos = useMemo(
    () =>
      [
        ...hideRejectedPayments(filterActiveAppointments(q.data?.ag ?? [])),
        ...(q.data?.ag ?? []).filter((a) => a.status === "cancelado" && !isCancellationMarker(a)),
      ].sort(
        (a, b) => new Date(b.appointment_time).getTime() - new Date(a.appointment_time).getTime(),
      ),
    [q.data?.ag],
  );

  const contagens = useMemo(() => {
    const c: Record<Periodo, number> = { semana: 0, mes: 0, ano: 0 };
    for (const p of PERIODOS) {
      const ini = inicioDoPeriodo(p.key).getTime();
      c[p.key] = todos.filter(
        (a) =>
          new Date(a.appointment_time).getTime() >= ini &&
          (a.status || "").trim().toLowerCase() !== "cancelado",
      ).length;
    }
    return c;
  }, [todos]);

  const historico = useMemo(() => {
    const ini = inicioDoPeriodo(periodo).getTime();
    return todos.filter((a) => new Date(a.appointment_time).getTime() >= ini);
  }, [todos, periodo]);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Atendimentos passados
      </h2>

      <div className="grid grid-cols-3 gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriodo(p.key)}
            className={cn(
              "surface flex flex-col items-center gap-1 p-3 transition-colors",
              periodo === p.key ? "border-primary ring-1 ring-primary" : "opacity-80",
            )}
          >
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {p.label}
            </span>
            <span className="brand-text text-2xl font-bold">{contagens[p.key]}</span>
            <span className="text-[10px] text-muted-foreground">atendimentos</span>
          </button>
        ))}
      </div>

      {historico.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Sem atendimentos neste período.
        </div>
      ) : (
        <div className="grid gap-2">
          {historico.map((a) => {
            const sv = svMap.get(a.service_id);
            const cancelado = a.status === "cancelado";
            return (
              <div
                key={a.id}
                className={
                  "surface flex items-center justify-between p-4" +
                  (cancelado ? " opacity-60" : "")
                }
              >
                <div className="min-w-0">
                  <p className={cn("font-semibold", cancelado && "line-through")}>
                    {a.customer_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sv?.name ?? "Serviço"} · {fmtDateTime(a.appointment_time)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!cancelado && <PaymentBadge status={a.payment_status} compact />}
                  {cancelado ? (
                    <span className="text-xs text-destructive">cancelado</span>
                  ) : (
                    <span className="brand-text font-bold">{sv ? brl(sv.price) : "—"}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

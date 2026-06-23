import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, WorkingHour, Service } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { buildSlots } from "@/lib/availability";
import { brl, fmtTime, DIAS_SEMANA } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AgendaTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dayKey = date.toISOString().slice(0, 10);

  const q = useQuery({
    queryKey: ["agenda-painel", barber.id, dayKey],
    queryFn: async () => {
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      const [a, h, s] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("barber_id", barber.id)
          .gte("appointment_time", date.toISOString())
          .lt("appointment_time", end.toISOString())
          .order("appointment_time"),
        supabase.from("working_hours").select("*").eq("barber_id", barber.id),
        supabase.from("services").select("*").eq("barber_id", barber.id),
      ]);
      if (a.error) throw a.error;
      if (h.error) throw h.error;
      if (s.error) throw s.error;
      return {
        appointments: a.data as Appointment[],
        hours: h.data as WorkingHour[],
        services: s.data as Service[],
      };
    },
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("appointments")
        .update({ status: "cancelado" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento cancelado");
      qc.invalidateQueries({ queryKey: ["agenda-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const servicesMap = useMemo(
    () => new Map<string, Service>((q.data?.services ?? []).map((s) => [s.id, s])),
    [q.data?.services],
  );

  const refService = q.data?.services.slice().sort((a, b) => a.duration_minutes - b.duration_minutes)[0];

  const slots = useMemo(() => {
    if (!refService || !q.data) return [];
    return buildSlots({
      date,
      service: refService,
      hours: q.data.hours,
      appointments: q.data.appointments,
      servicesMap,
    });
  }, [date, refService, q.data, servicesMap]);

  function move(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(d);
  }

  const ativos = (q.data?.appointments ?? []).filter((a) => a.status !== "cancelado");
  const cancelados = (q.data?.appointments ?? []).filter((a) => a.status === "cancelado");

  return (
    <div className="space-y-6">
      <div className="surface flex items-center justify-between p-3">
        <Button variant="ghost" size="icon" onClick={() => move(-1)}>
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{DIAS_SEMANA[date.getDay()]}</p>
          <p className="font-semibold">
            {date.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => move(1)}>
          <ChevronRight />
        </Button>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Agendamentos
        </h2>
        {ativos.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum agendamento neste dia.
          </div>
        ) : (
          <div className="grid gap-2">
            {ativos.map((a) => {
              const sv = servicesMap.get(a.service_id);
              return (
                <div key={a.id} className="surface flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">
                      {fmtTime(a.appointment_time)} · {a.customer_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {sv?.name ?? "Serviço"} · {sv?.duration_minutes ?? "?"} min ·{" "}
                      {a.customer_phone}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="brand-text font-bold">{sv ? brl(sv.price) : ""}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Cancelar este agendamento?")) cancel.mutate(a.id);
                      }}
                    >
                      <X className="text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Mapa de horários
        </h2>
        {!refService ? (
          <p className="text-sm text-muted-foreground">
            Cadastre um serviço para ver o mapa de horários.
          </p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem expediente neste dia.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {slots.map((s) => (
              <div
                key={s.start.toISOString()}
                className={cn(
                  "rounded-lg border px-2 py-2 text-center text-xs font-medium",
                  s.available
                    ? "border-border bg-card/60 text-foreground"
                    : "slot-strike border-destructive/30 bg-card/40",
                )}
              >
                {fmtTime(s.start)}
              </div>
            ))}
          </div>
        )}
      </section>

      {cancelados.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Cancelados
          </h2>
          <div className="grid gap-2">
            {cancelados.map((a) => (
              <div key={a.id} className="surface flex items-center justify-between p-3 opacity-60">
                <p className="text-sm line-through">
                  {fmtTime(a.appointment_time)} · {a.customer_name}
                </p>
                <span className="text-xs text-destructive">cancelado</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

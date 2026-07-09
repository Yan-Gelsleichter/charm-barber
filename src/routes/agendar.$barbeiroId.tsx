import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, WorkingHour, Service, Appointment } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { useSession } from "@/hooks/use-auth";
import { brl, fmtTime, phoneDigits } from "@/lib/format";
import { buildSlots } from "@/lib/availability";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agendar/$barbeiroId")({
  head: () => ({ meta: [{ title: "Agendar — VIP BARBER" }] }),
  component: AgendarPage,
});

function AgendarPage() {
  const { barbeiroId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");

  const barberQ = useQuery({
    queryKey: ["barber", barbeiroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbers")
        .select("*")
        .eq("id", barbeiroId)
        .maybeSingle();
      if (error) throw error;
      return data as Barber | null;
    },
  });

  const servicesQ = useQuery({
    queryKey: ["services", barbeiroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("barber_id", barbeiroId)
        .order("name");
      if (error) throw error;
      return data as Service[];
    },
  });

  const hoursQ = useQuery({
    queryKey: ["working_hours", barbeiroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("working_hours")
        .select("*")
        .eq("barber_id", barbeiroId);
      if (error) throw error;
      return data as WorkingHour[];
    },
  });

  const dayKey = date ? date.toISOString().slice(0, 10) : null;
  const agendaQ = useQuery({
    queryKey: ["agenda", barbeiroId, dayKey],
    enabled: !!dayKey,
    queryFn: async () => {
      const start = new Date(date!);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const { data, error } = await supabase
        .from("appointments")
        .select("appointment_time, service_id, status")
        .eq("barber_id", barbeiroId)
        .gte("appointment_time", start.toISOString())
        .lt("appointment_time", end.toISOString());
      if (error) throw error;
      return data as Pick<Appointment, "appointment_time" | "service_id" | "status">[];
    },
  });

  const service = servicesQ.data?.find((s) => s.id === serviceId) ?? null;
  const servicesMap = useMemo(
    () => new Map<string, Service>((servicesQ.data ?? []).map((s) => [s.id, s])),
    [servicesQ.data],
  );

  const slots = useMemo(() => {
    if (!date || !service || !hoursQ.data) return [];
    return buildSlots({
      date,
      service,
      hours: hoursQ.data,
      appointments: agendaQ.data ?? [],
      servicesMap,
    });
  }, [date, service, hoursQ.data, agendaQ.data, servicesMap]);

  const create = useMutation({
    mutationFn: async () => {
      if (!service || !slotIso) throw new Error("Selecione serviço e horário");
      if (nome.trim().length < 2) throw new Error("Informe seu nome");
      if (phoneDigits(tel).length < 10) throw new Error("Telefone inválido");
      const { error } = await supabase.from("appointments").insert({
        barber_id: barbeiroId,
        service_id: service.id,
        customer_name: nome.trim(),
        customer_phone: phoneDigits(tel),
        appointment_time: slotIso,
        status: "confirmado",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", barbeiroId] });
      toast.success("Agendamento confirmado!", {
        description: `${fmtTime(slotIso!)} com ${barberQ.data?.name}`,
      });
      navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const barber = barberQ.data;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/">
          <ArrowLeft /> Voltar
        </Link>
      </Button>

      {barber && (
        <header className="surface flex items-center gap-4 p-4">
          <div className="brand-gradient flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-bold text-white">
            {barber.avatar_url ? (
              <img src={barber.avatar_url} alt={barber.name} className="h-full w-full object-cover" />
            ) : (
              barber.name.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Agendando com
            </p>
            <p className="text-lg font-semibold">{barber.name}</p>
          </div>
        </header>
      )}

      {/* Step 1 — serviço */}
      <Step title="1. Escolha o serviço">
        {servicesQ.isLoading && <Skeleton />}
        {servicesQ.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Este barbeiro ainda não cadastrou serviços.
          </p>
        )}
        <div className="grid gap-2">
          {servicesQ.data?.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setServiceId(s.id);
                setSlotIso(null);
              }}
              className={cn(
                "flex items-center justify-between rounded-xl border p-4 text-left transition-all",
                serviceId === s.id
                  ? "brand-gradient-soft border-transparent shadow-[var(--shadow-elev)]"
                  : "border-border bg-card/60 hover:border-border/80",
              )}
            >
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  <Clock className="mr-1 inline size-3" />
                  {s.duration_minutes} min
                </p>
              </div>
              <div className="text-right">
                <p className="brand-text font-bold">{brl(s.price)}</p>
                {serviceId === s.id && (
                  <Check className="ml-auto mt-1 size-4 text-[color:var(--success)]" />
                )}
              </div>
            </button>
          ))}
        </div>
      </Step>

      {/* Step 2 — data */}
      {service && (
        <Step title="2. Escolha a data">
          <div className="surface flex justify-center p-2">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => {
                setDate(d ?? undefined);
                setSlotIso(null);
              }}
              disabled={(d) => {
                const t = new Date();
                t.setHours(0, 0, 0, 0);
                return d < t;
              }}
              className="pointer-events-auto"
            />
          </div>
        </Step>
      )}

      {/* Step 3 — horário */}
      {service && date && (
        <Step title="3. Escolha o horário">
          {(hoursQ.isLoading || agendaQ.isLoading) && <Skeleton />}
          {!hoursQ.isLoading && slots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sem expediente neste dia.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => {
              const iso = s.start.toISOString();
              const selected = slotIso === iso;
              return (
                <button
                  key={iso}
                  disabled={!s.available}
                  onClick={() => setSlotIso(iso)}
                  className={cn(
                    "rounded-xl border px-2 py-3 text-sm font-medium transition-all",
                    !s.available && "slot-strike cursor-not-allowed border-border bg-card/40",
                    s.available && !selected && "border-border bg-card/60 hover:brand-gradient-soft",
                    selected && "brand-gradient border-transparent text-white shadow-[var(--shadow-elev)]",
                  )}
                >
                  {fmtTime(s.start)}
                </button>
              );
            })}
          </div>
        </Step>
      )}

      {/* Step 4 — dados */}
      {service && slotIso && (
        <Step title="4. Seus dados">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome completo</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Como devemos te chamar"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tel">Telefone</Label>
              <PhoneInput id="tel" value={tel} onChange={setTel} />
            </div>
            <Button
              variant="hero"
              size="xl"
              className="w-full"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : "Confirmar agendamento"}
            </Button>
          </div>
        </Step>
      )}
    </main>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 px-1 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface h-14 animate-pulse" />
      ))}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Check, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, WorkingHour, Service, Appointment } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { useSession } from "@/hooks/use-auth";
import { brl, fmtTime, phoneDigits } from "@/lib/format";
import { buildSlots, filterActiveAppointments } from "@/lib/availability";
import { postPublicApi } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agendar/$barbeiroId")({
  head: () => ({
    meta: [
      { title: "Agendar horário — VIP BARBER" },
      { name: "description", content: "Escolha um serviço, data e horário para seu atendimento." },
      { property: "og:title", content: "Agendar horário — VIP BARBER" },
      { property: "og:description", content: "Escolha um serviço, data e horário para seu atendimento." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (
    s: Record<string, unknown>,
  ): { remarcar?: string; servico?: string; data?: string } => ({
    remarcar: typeof s.remarcar === "string" ? s.remarcar : undefined,
    servico: typeof s.servico === "string" ? s.servico : undefined,
    data: typeof s.data === "string" ? s.data : undefined,
  }),
  component: AgendarPage,
});

function AgendarPage() {
  const { barbeiroId } = Route.useParams();
  const { remarcar, servico, data } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { session } = useSession();
  const [serviceId, setServiceId] = useState<string | null>(servico ?? null);
  const [date, setDate] = useState<Date | undefined>(() => (data ? new Date(`${data}T12:00:00`) : new Date()));
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const meta = (session?.user.user_metadata ?? {}) as Record<string, string | undefined>;
  const [clientName, setClientName] = useState(() =>
    (meta.name || meta.full_name || "").toString(),
  );
  const [clientPhone, setClientPhone] = useState(() =>
    (meta.whatsapp_digits || meta.whatsapp || "").toString(),
  );
  const clientEmail = (session?.user.email ?? meta.email ?? "").toString().trim().toLowerCase() || null;

  useEffect(() => {
    if (!session) return;
    const nextMeta = (session.user.user_metadata ?? {}) as Record<string, string | undefined>;
    setClientName((current) => current || nextMeta.name || nextMeta.full_name || "");
    setClientPhone((current) => current || nextMeta.whatsapp_digits || nextMeta.whatsapp || "");
  }, [session]);


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

  // Chave do dia em horário LOCAL (toISOString usaria UTC e podia trocar de dia,
  // fazendo a primeira busca cair na data errada).
  const dayKey = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : null;
  const agendaQ = useQuery({
    queryKey: ["agenda", barbeiroId, dayKey],
    enabled: !!dayKey,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [y, m, d] = dayKey!.split("-").map(Number);
      const start = new Date(y, m - 1, d);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      // Os agendamentos de outros clientes não são visíveis por RLS, por isso a
      // disponibilidade vem de uma função que devolve só os intervalos ocupados.
      const busy = (await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: Record<string, string>,
          ) => Promise<{ data: Array<{ start_time: string; end_time: string }> | null; error: unknown }>;
        }
      ).rpc("barber_busy_intervals", {
        p_barber_id: barbeiroId,
        p_from: start.toISOString(),
        p_to: end.toISOString(),
      }));


      const { data, error } = await supabase
        .from("appointments")
        .select("id, appointment_time, service_id, status, customer_phone, customer_name")
        .eq("barber_id", barbeiroId)
        .gte("appointment_time", start.toISOString())
        .lt("appointment_time", end.toISOString());
      if (error) throw error;

      let blocks: Array<{ start_time: string; end_time: string }> = [];
      if (!busy.error && busy.data) {
        blocks = (busy.data as Array<{ start_time: string; end_time: string }>).filter(
          (b) => b.start_time && b.end_time,
        );
      } else {
        const fallback = await supabase
          .from("schedule_blocks")
          .select("start_time, end_time")
          .eq("barber_id", barbeiroId)
          .gte("start_time", start.toISOString())
          .lt("start_time", end.toISOString());
        if (fallback.error) throw fallback.error;
        blocks = (fallback.data ?? []) as Array<{ start_time: string; end_time: string }>;
      }

      return {
        appointments: data as Pick<Appointment, "id" | "appointment_time" | "service_id" | "status" | "customer_phone" | "customer_name">[],
        blocks,
      };
    },

  });

  const service = servicesQ.data?.find((s) => s.id === serviceId) ?? null;
  const servicesMap = useMemo(
    () => new Map<string, Service>((servicesQ.data ?? []).map((s) => [s.id, s])),
    [servicesQ.data],
  );

  const slots = useMemo(() => {
    // Só monta os horários quando a agenda do dia já chegou, senão tudo apareceria livre.
    if (!date || !service || !hoursQ.data || !agendaQ.data) return [];
    const appointments = filterActiveAppointments(agendaQ.data.appointments ?? []).filter((a) => a.id !== remarcar);

    return buildSlots({
      date,
      service,
      hours: hoursQ.data,
      appointments,
      servicesMap,
      blocks: agendaQ.data?.blocks ?? [],
    });
  }, [date, service, hoursQ.data, agendaQ.data, servicesMap, remarcar]);

  const create = useMutation({
    mutationFn: async () => {
      if (!service || !slotIso) throw new Error("Selecione serviço e horário");
      const customerName = clientName.trim();
      // Limpeza obrigatória do telefone: remove parênteses, espaços, traços
      // e qualquer outro caractere não numérico antes de enviar para a API.
      // O backend valida com /^\d{8,15}$/ — enviar com máscara faz o agendamento
      // falhar (sobretudo no celular, por autofill/autocomplete mascarado).
      const customerPhone = phoneDigits(clientPhone);
      if (customerName.length < 2) throw new Error("Informe seu nome");
      if (customerPhone.length < 8) throw new Error("Informe um telefone válido");
      // O barbershop_id é resolvido no servidor pela função transacional.

      // Todo agendamento (novo ou remarcado) nasce na API central, que grava
      // appointments + clients na mesma transação do banco.
      const appointmentBody = {
        barber_id: barbeiroId,
        service_id: service.id,
        customer_name: customerName,
        // Segunda barreira de segurança: garante dígitos puros mesmo se a
        // fonte do valor vier mascarada por autofill do navegador.
        customer_phone: phoneDigits(customerPhone),
        email: clientEmail,
        appointment_time: slotIso,
      };
      type CreateResult = {
        id?: string;
        client_id?: string;
        persisted?: boolean;
        appointment?: {
          id: string;
          barber_id: string;
          service_id: string;
          customer_phone: string;
          appointment_time: string;
        };
        client?: {
          id: string;
          barber_id: string;
          name: string;
          whatsapp: string | null;
        };
        error?: string;
      };

      // Celular e computador usam exatamente a mesma chamada autoritativa.
      const payload = await postPublicApi<CreateResult>(
        "/api/public/appointment-create",
        appointmentBody,
        session?.access_token,
      );
      const confirmed = payload?.appointment;
      const confirmedClient = payload?.client;
      if (
        !payload?.id ||
        !payload.client_id ||
        payload.persisted !== true ||
        !confirmed ||
        !confirmedClient ||
        confirmed.id !== payload.id ||
        confirmed.barber_id !== barbeiroId ||
        confirmed.service_id !== service.id ||
        confirmed.customer_phone !== customerPhone ||
        new Date(confirmed.appointment_time).getTime() !== new Date(slotIso).getTime() ||
        confirmedClient.id !== payload.client_id ||
        confirmedClient.barber_id !== barbeiroId ||
        confirmedClient.whatsapp !== customerPhone ||
        confirmedClient.name.trim() !== customerName
      ) {
        throw new Error(
          payload?.error ?? "Erro ao salvar agendamento: o servidor não confirmou a gravação.",
        );
      }
      const createdId = payload.id;

      // Segunda confirmação, agora pelo mesmo cliente de banco usado pelo painel.
      // Isso impede avançar caso a API e o navegador estejam apontando para
      // instâncias diferentes ou se as linhas não estiverem realmente visíveis.
      const [browserAppointment, browserClient] = await Promise.all([
        supabase
          .from("appointments")
          .select("id, barber_id, service_id, customer_name, customer_phone, appointment_time")
          .eq("id", createdId)
          .eq("barber_id", barbeiroId)
          .eq("service_id", service.id)
          .maybeSingle(),
        supabase
          .from("clients")
          .select("id, barber_id, name, whatsapp")
          .eq("id", payload.client_id)
          .eq("barber_id", barbeiroId)
          .maybeSingle(),
      ]);
      const verifiedAppointment = browserAppointment.data;
      const verifiedClient = browserClient.data;
      if (
        browserAppointment.error ||
        browserClient.error ||
        !verifiedAppointment ||
        !verifiedClient ||
        verifiedAppointment.customer_phone !== customerPhone ||
        verifiedAppointment.customer_name.trim() !== customerName ||
        new Date(verifiedAppointment.appointment_time).getTime() !== new Date(slotIso).getTime() ||
        verifiedClient.whatsapp !== customerPhone ||
        verifiedClient.name.trim() !== customerName
      ) {
        console.error("[agendar] confirmação direta no banco falhou", {
          appointmentId: createdId,
          appointmentError: browserAppointment.error?.message,
          clientError: browserClient.error?.message,
          appointmentFound: Boolean(verifiedAppointment),
          clientFound: Boolean(verifiedClient),
        });
        throw new Error(
          "Erro ao salvar agendamento: o banco não confirmou o agendamento e o cliente. Tente novamente.",
        );
      }

      // Remarcação: o horário anterior é liberado somente depois que o novo
      // agendamento já está confirmado no banco.
      if (remarcar) {
        const { error: releaseError } = await supabase
          .from("appointments")
          .update({ status: "remarcado" })
          .eq("id", remarcar)
          .eq("customer_phone", phoneDigits(clientPhone));
        if (releaseError) {
          console.warn("[agendar] não foi possível liberar o horário anterior", releaseError);
        }
      }

      return createdId;

    },
    onSuccess: async (appointmentId) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["agenda", barbeiroId] }),
        qc.invalidateQueries({ queryKey: ["my-appointments"] }),
      ]);
      toast.success("Horário reservado!", {
        description: `${fmtTime(slotIso!)} com ${barberQ.data?.name}`,
      });
      if (appointmentId) {
        navigate({ to: "/pagamento/$appointmentId", params: { appointmentId } });
      } else {
        navigate({ to: "/meus-agendamentos" });
      }
    },

    onError: (e: Error) => {
      const message = e.message.startsWith("Erro ao salvar agendamento:")
        ? e.message
        : `Erro ao salvar agendamento: ${e.message}`;
      setCreateError(message);
      toast.error(message);
    },
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
                setCreateError(null);
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
                setCreateError(null);
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
          {(hoursQ.isPending || agendaQ.isPending || agendaQ.isFetching) && <Skeleton />}
          {!hoursQ.isPending && !agendaQ.isPending && !agendaQ.isFetching && slots.length === 0 && (

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
                  onClick={() => {
                    setSlotIso(iso);
                    setCreateError(null);
                  }}
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

      {/* Step 4 — confirmação */}
      {service && slotIso && (
        <Step title="4. Confirmar">
          <div className="space-y-4">
            <div className="surface grid gap-3 p-4">
              <label className="grid gap-1.5 text-sm font-medium">
                Nome
                <Input
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Seu nome"
                  autoComplete="name"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Telefone
                <PhoneInput
                  value={clientPhone}
                  onChange={setClientPhone}
                  autoComplete="tel"
                />
              </label>
            </div>
            <div className="surface space-y-3 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Serviço</p>
                  <p className="font-semibold">{service.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <Clock className="mr-1 inline size-3" />
                    {service.duration_minutes} min
                  </p>
                </div>
                <p className="brand-text font-bold">{brl(service.price)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Data</p>
                  <p className="font-semibold capitalize">
                    {new Date(slotIso).toLocaleDateString("pt-BR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Horário</p>
                  <p className="font-semibold">{fmtTime(slotIso)}</p>
                </div>
              </div>
            </div>
            <Button
              variant="hero"
              size="xl"
              className="w-full"
              onClick={() => {
                setCreateError(null);
                create.mutate();
              }}
              disabled={create.isPending}
            >
              {create.isPending ? <Loader2 className="animate-spin" /> : "Confirmar agendamento"}
            </Button>
            {createError && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-5 shrink-0" />
                <p className="break-words font-medium">{createError}</p>
              </div>
            )}
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

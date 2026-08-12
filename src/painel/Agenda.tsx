import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X, Lock, RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, WorkingHour, Service, ScheduleBlock } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBarbershopIdByBarberId } from "@/lib/barbershop";
import {
  buildSlots,
  cancelledAppointmentIds,
  filterActiveAppointments,
  isCancellationMarker,
  isBlock,
} from "@/lib/availability";
import { brl, fmtTime, DIAS_SEMANA } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PaymentBadge } from "@/components/PaymentBadge";
import { PhoneInput } from "@/components/PhoneInput";


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
    refetchInterval: 20_000,
    queryFn: async () => {

      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      const [a, h, s, b] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("barber_id", barber.id)
          .gte("appointment_time", date.toISOString())
          .lt("appointment_time", end.toISOString())
          .order("appointment_time"),
        supabase.from("working_hours").select("*").eq("barber_id", barber.id),
        supabase.from("services").select("*").eq("barber_id", barber.id),
        supabase
          .from("schedule_blocks")
          .select("*")
          .eq("barber_id", barber.id)
          .gte("start_time", date.toISOString())
          .lt("start_time", end.toISOString())
          .order("start_time"),
      ]);
      if (a.error) throw a.error;
      if (h.error) throw h.error;
      if (s.error) throw s.error;
      if (b.error) throw b.error;
      return {
        appointments: a.data as Appointment[],
        hours: h.data as WorkingHour[],
        services: s.data as Service[],
        blocks: b.data as ScheduleBlock[],
      };
    },
  });


  // ---- Reagendamento (barbeiro) ----
  const [reschedId, setReschedId] = useState<string | null>(null);
  const [reschedDate, setReschedDate] = useState(() => new Date().toISOString().slice(0, 10));

  const reschedTarget = (q.data?.appointments ?? []).find((a) => a.id === reschedId) ?? null;

  const reschedQ = useQuery({
    enabled: !!reschedId,
    queryKey: ["remarcar-painel", barber.id, reschedDate],
    queryFn: async () => {
      const start = new Date(`${reschedDate}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const [a, b] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .eq("barber_id", barber.id)
          .gte("appointment_time", start.toISOString())
          .lt("appointment_time", end.toISOString()),
        supabase
          .from("schedule_blocks")
          .select("*")
          .eq("barber_id", barber.id)
          .gte("start_time", start.toISOString())
          .lt("start_time", end.toISOString()),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      return { appointments: a.data as Appointment[], blocks: b.data as ScheduleBlock[] };
    },
  });

  const reagendar = useMutation({
    mutationFn: async (novoInicio: Date) => {
      if (!reschedId) return;
      const { error } = await supabase
        .from("appointments")
        .update({ appointment_time: novoInicio.toISOString(), status: "confirmado" })
        .eq("id", reschedId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento remarcado");
      setReschedId(null);
      qc.invalidateQueries({ queryKey: ["agenda-painel", barber.id] });
      qc.invalidateQueries({ queryKey: ["remarcar-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Novo agendamento manual (barbeiro) ----
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novoServico, setNovoServico] = useState("");

  const criarAgendamento = useMutation({
    mutationFn: async (inicio: Date) => {
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome do cliente.");
      const telefone = novoTelefone.trim();
      if (telefone.replace(/\D/g, "").length < 10) throw new Error("Informe um telefone válido.");
      if (!novoServico) throw new Error("Selecione um serviço.");
      const barbershopId = await getBarbershopIdByBarberId(barber.id);
      const { error } = await supabase.from("appointments").insert({
        barber_id: barber.id,
        barbershop_id: barbershopId,
        service_id: novoServico,
        customer_name: nome,
        customer_phone: telefone,
        email: novoEmail.trim() || null,
        appointment_time: inicio.toISOString(),
        status: "confirmado",
      });
      if (error) throw error;

      const { data: existentes } = await supabase
        .from("clients")
        .select("id")
        .eq("barber_id", barber.id)
        .eq("whatsapp", telefone)
        .limit(1);
      if (!existentes?.length) {
        await supabase.from("clients").insert({
          barber_id: barber.id,
          barbershop_id: barbershopId,
          name: nome,
          whatsapp: telefone,
          email: novoEmail.trim() || null,
        });
      }
    },
    onSuccess: () => {
      toast.success("Agendamento criado");
      setNovoNome("");
      setNovoTelefone("");
      setNovoEmail("");
      setNovoOpen(false);
      qc.invalidateQueries({ queryKey: ["agenda-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [blockOpen, setBlockOpen] = useState(false);
  const [blockStart, setBlockStart] = useState("12:00");
  const [blockEnd, setBlockEnd] = useState("13:00");
  const [blockReason, setBlockReason] = useState("");


  function timeOnDate(hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(date);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  }

  const createBlock = useMutation({
    mutationFn: async () => {
      const start = timeOnDate(blockStart);
      const end = timeOnDate(blockEnd);
      if (end.getTime() <= start.getTime()) throw new Error("O horário final deve ser maior que o inicial.");
      const barbershopId = await getBarbershopIdByBarberId(barber.id);
      const { error } = await supabase.from("schedule_blocks").insert({
        barber_id: barber.id,
        barbershop_id: barbershopId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        reason: blockReason.trim() || "Compromisso",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agenda bloqueada");
      setBlockOpen(false);
      setBlockReason("");
      qc.invalidateQueries({ queryKey: ["agenda-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeBlock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedule_blocks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bloqueio removido");
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
      blocks: q.data.blocks,
    });
  }, [date, refService, q.data, servicesMap]);

  const novoSlots = useMemo(() => {
    const sv = servicesMap.get(novoServico);
    if (!sv || !q.data) return [];
    return buildSlots({
      date,
      service: sv,
      hours: q.data.hours,
      appointments: q.data.appointments,
      servicesMap,
      blocks: q.data.blocks,
    });
  }, [date, novoServico, q.data, servicesMap]);



  const reschedSlots = useMemo(() => {
    if (!reschedTarget || !q.data || !reschedQ.data) return [];
    const sv = servicesMap.get(reschedTarget.service_id);
    if (!sv) return [];
    return buildSlots({
      date: new Date(`${reschedDate}T00:00:00`),
      service: sv,
      hours: q.data.hours,
      appointments: reschedQ.data.appointments.filter((a) => a.id !== reschedTarget.id),
      servicesMap,
      blocks: reschedQ.data.blocks,
    });
  }, [reschedTarget, reschedDate, q.data, reschedQ.data, servicesMap]);


  function move(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(d);
  }

  const allAppts = q.data?.appointments ?? [];
  const ativosAll = filterActiveAppointments(allAppts);
  const ativos = ativosAll.filter((a) => !isBlock(a));
  const bloqueios = q.data?.blocks ?? [];
  const cancelMarkerTargets = cancelledAppointmentIds(
    allAppts.filter((a) => (a.status || "").trim().toLowerCase() === "cancelado"),
  );
  const cancelados = allAppts.filter((a) => {
    if (isCancellationMarker(a) || isBlock(a)) return false;
    const status = (a.status || "").trim().toLowerCase();
    if (status === "remarcado" || status.startsWith("cancelado:")) return false;
    return status === "cancelado" || cancelMarkerTargets.has(a.id);
  });

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

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Novo agendamento
          </h2>
          <Button variant="outline" size="sm" onClick={() => setNovoOpen((v) => !v)}>
            <Plus className="mr-1 size-4" />
            {novoOpen ? "Fechar" : "Agendar cliente"}
          </Button>
        </div>

        {novoOpen && (
          <div className="surface grid gap-3 p-4">
            <p className="text-xs text-muted-foreground">
              Informe os dados do cliente e escolha um horário livre do dia selecionado.
            </p>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Nome do cliente
              <Input
                value={novoNome}
                maxLength={80}
                placeholder="Ex.: João Silva"
                onChange={(e) => setNovoNome(e.target.value)}
              />
            </label>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                WhatsApp / Telefone
                <PhoneInput value={novoTelefone} onChange={setNovoTelefone} />
              </label>
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                E-mail (opcional)
                <Input
                  type="email"
                  maxLength={120}
                  value={novoEmail}
                  placeholder="cliente@email.com"
                  onChange={(e) => setNovoEmail(e.target.value)}
                />
              </label>
            </div>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Serviço
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={novoServico}
                onChange={(e) => setNovoServico(e.target.value)}
              >
                <option value="">Selecione um serviço</option>
                {(q.data?.services ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.duration_minutes} min · {brl(s.price)}
                  </option>
                ))}
              </select>
            </label>

            {!novoServico ? (
              <p className="text-xs text-muted-foreground">Selecione um serviço para ver os horários.</p>
            ) : novoSlots.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem expediente neste dia.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {novoSlots.map((s) => (
                  <button
                    key={s.start.toISOString()}
                    type="button"
                    disabled={!s.available || criarAgendamento.isPending}
                    onClick={() => {
                      if (confirm(`Agendar ${novoNome || "cliente"} às ${fmtTime(s.start)}?`))
                        criarAgendamento.mutate(s.start);
                    }}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-center text-xs font-medium transition",
                      s.available
                        ? "border-border bg-card/60 hover:border-primary hover:text-primary"
                        : "slot-strike cursor-not-allowed border-destructive/30 bg-card/40 opacity-60",
                    )}
                  >
                    {fmtTime(s.start)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>


      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Bloqueios
          </h2>
          <Button variant="outline" size="sm" onClick={() => setBlockOpen((v) => !v)}>
            <Lock className="mr-1 size-4" />
            {blockOpen ? "Fechar" : "Bloquear agenda"}
          </Button>
        </div>

        {blockOpen && (
          <div className="surface grid gap-3 p-4">
            <p className="text-xs text-muted-foreground">
              Bloqueie um período deste dia para compromissos fora da barbearia. Os horários ficam
              indisponíveis para os clientes.
            </p>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Início
                <Input
                  type="time"
                  className="min-w-0 max-w-full [appearance:none] [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left"
                  value={blockStart}
                  onChange={(e) => setBlockStart(e.target.value)}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Fim
                <Input
                  type="time"
                  className="min-w-0 max-w-full [appearance:none] [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left"
                  value={blockEnd}
                  onChange={(e) => setBlockEnd(e.target.value)}
                />
              </label>
            </div>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Motivo (opcional)
              <Input
                value={blockReason}
                placeholder="Ex.: consulta médica"
                onChange={(e) => setBlockReason(e.target.value)}
              />
            </label>
            <Button onClick={() => createBlock.mutate()} disabled={createBlock.isPending}>
              {createBlock.isPending ? "Bloqueando..." : "Confirmar bloqueio"}
            </Button>
          </div>
        )}

        {bloqueios.length > 0 && (
          <div className="grid gap-2">
            {bloqueios.map((a) => {
              return (
                <div
                  key={a.id}
                  className="surface grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {fmtTime(a.start_time)} – {fmtTime(a.end_time)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.reason || "Compromisso"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      if (confirm("Remover este bloqueio?")) removeBlock.mutate(a.id);
                    }}
                  >
                    <X className="text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>


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
              const fim =
                new Date(a.appointment_time).getTime() + (sv?.duration_minutes ?? 30) * 60_000;
              const atendido = fim <= Date.now();
              return (
                <div
                  key={a.id}
                  className={cn(
                    "surface flex flex-col gap-2 p-4",
                    atendido && "opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold leading-tight">
                        {a.customer_name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {sv?.name ?? "Serviço"} · {sv?.duration_minutes ?? "?"} min
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-primary">{sv ? brl(sv.price) : "—"}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(a.appointment_time)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentBadge status={a.payment_status} compact />
                    {atendido && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        Atendido
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{a.customer_phone}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => {
                        setReschedId((cur) => (cur === a.id ? null : a.id));
                        setReschedDate(new Date(a.appointment_time).toISOString().slice(0, 10));
                      }}
                    >
                      <RefreshCw className="mr-1 size-4" />
                      {reschedId === a.id ? "Fechar" : "Remarcar"}
                    </Button>
                  </div>

                  {reschedId === a.id && (
                    <div className="grid gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
                      <label className="grid gap-1 text-xs text-muted-foreground">
                        Nova data
                        <Input
                          type="date"
                          className="min-w-0 max-w-full"
                          value={reschedDate}
                          onChange={(e) => setReschedDate(e.target.value)}
                        />
                      </label>
                      {reschedQ.isLoading ? (
                        <p className="text-xs text-muted-foreground">Carregando horários...</p>
                      ) : reschedSlots.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sem expediente nesta data.</p>
                      ) : (
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                          {reschedSlots.map((s) => (
                            <button
                              key={s.start.toISOString()}
                              type="button"
                              disabled={!s.available || reagendar.isPending}
                              onClick={() => {
                                if (confirm(`Remarcar para ${fmtTime(s.start)}?`)) reagendar.mutate(s.start);
                              }}
                              className={cn(
                                "rounded-lg border px-2 py-2 text-center text-xs font-medium transition",
                                s.available
                                  ? "border-border bg-card/60 hover:border-primary hover:text-primary"
                                  : "slot-strike cursor-not-allowed border-destructive/30 bg-card/40 opacity-60",
                              )}
                            >
                              {fmtTime(s.start)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
              <div
                key={a.id}
                className="surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 opacity-60"
              >
                <p className="min-w-0 truncate text-sm line-through">
                  {fmtTime(a.appointment_time)} · {a.customer_name}
                </p>
                <span className="shrink-0 text-xs text-destructive">cancelado</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

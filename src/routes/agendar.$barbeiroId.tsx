import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barbeiro, HorarioTrabalho, Servico, Agendamento } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { PhoneInput } from "@/components/PhoneInput";
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

  const [servicoId, setServicoId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");

  const barbeiroQ = useQuery({
    queryKey: ["barbeiro", barbeiroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbeiros")
        .select("*")
        .eq("id", barbeiroId)
        .maybeSingle();
      if (error) throw error;
      return data as Barbeiro | null;
    },
  });

  const servicosQ = useQuery({
    queryKey: ["servicos", barbeiroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("servicos")
        .select("*")
        .eq("barbeiro_id", barbeiroId)
        .order("nome");
      if (error) throw error;
      return data as Servico[];
    },
  });

  const horariosQ = useQuery({
    queryKey: ["horarios", barbeiroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("horarios_trabalho")
        .select("*")
        .eq("barbeiro_id", barbeiroId);
      if (error) throw error;
      return data as HorarioTrabalho[];
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
        .from("agendamentos")
        .select("horario_consulta, servico_id, status")
        .eq("barbeiro_id", barbeiroId)
        .gte("horario_consulta", start.toISOString())
        .lt("horario_consulta", end.toISOString());
      if (error) throw error;
      return data as Pick<Agendamento, "horario_consulta" | "servico_id" | "status">[];
    },
  });

  const servico = servicosQ.data?.find((s) => s.id === servicoId) ?? null;
  const servicosMap = useMemo(
    () => new Map<string, Servico>((servicosQ.data ?? []).map((s) => [s.id, s])),
    [servicosQ.data],
  );

  const slots = useMemo(() => {
    if (!date || !servico || !horariosQ.data) return [];
    return buildSlots({
      date,
      servico,
      horarios: horariosQ.data,
      agendamentos: agendaQ.data ?? [],
      servicosMap,
    });
  }, [date, servico, horariosQ.data, agendaQ.data, servicosMap]);

  const create = useMutation({
    mutationFn: async () => {
      if (!servico || !slotIso) throw new Error("Selecione serviço e horário");
      if (nome.trim().length < 2) throw new Error("Informe seu nome");
      if (phoneDigits(tel).length < 10) throw new Error("Telefone inválido");
      const { error } = await supabase.from("agendamentos").insert({
        barbeiro_id: barbeiroId,
        servico_id: servico.id,
        nome_cliente: nome.trim(),
        telefone_cliente: phoneDigits(tel),
        horario_consulta: slotIso,
        status: "confirmado",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", barbeiroId] });
      toast.success("Agendamento confirmado!", {
        description: `${fmtTime(slotIso!)} com ${barbeiroQ.data?.nome}`,
      });
      navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const barbeiro = barbeiroQ.data;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/">
          <ArrowLeft /> Voltar
        </Link>
      </Button>

      {barbeiro && (
        <header className="surface flex items-center gap-4 p-4">
          <div className="brand-gradient flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-bold text-white">
            {barbeiro.avatar_url ? (
              <img src={barbeiro.avatar_url} alt={barbeiro.nome} className="h-full w-full object-cover" />
            ) : (
              barbeiro.nome.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Agendando com
            </p>
            <p className="text-lg font-semibold">{barbeiro.nome}</p>
          </div>
        </header>
      )}

      {/* Step 1 — serviço */}
      <Step title="1. Escolha o serviço">
        {servicosQ.isLoading && <Skeleton />}
        {servicosQ.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Este barbeiro ainda não cadastrou serviços.
          </p>
        )}
        <div className="grid gap-2">
          {servicosQ.data?.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setServicoId(s.id);
                setSlotIso(null);
              }}
              className={cn(
                "flex items-center justify-between rounded-xl border p-4 text-left transition-all",
                servicoId === s.id
                  ? "brand-gradient-soft border-transparent shadow-[var(--shadow-elev)]"
                  : "border-border bg-card/60 hover:border-border/80",
              )}
            >
              <div>
                <p className="font-medium">{s.nome}</p>
                <p className="text-xs text-muted-foreground">
                  <Clock className="mr-1 inline size-3" />
                  {s.duracao_minutos} min
                </p>
              </div>
              <div className="text-right">
                <p className="brand-text font-bold">{brl(s.preco)}</p>
                {servicoId === s.id && (
                  <Check className="ml-auto mt-1 size-4 text-[color:var(--success)]" />
                )}
              </div>
            </button>
          ))}
        </div>
      </Step>

      {/* Step 2 — data */}
      {servico && (
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
      {servico && date && (
        <Step title="3. Escolha o horário">
          {(horariosQ.isLoading || agendaQ.isLoading) && <Skeleton />}
          {!horariosQ.isLoading && slots.length === 0 && (
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
      {servico && slotIso && (
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

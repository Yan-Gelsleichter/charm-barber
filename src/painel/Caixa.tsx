import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Loader2, Pencil, Trash2, FileText, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentBadge } from "@/components/PaymentBadge";
import { postPublicApi } from "@/lib/api-fetch";
import { brl, fmtTime, DIAS_SEMANA } from "@/lib/format";
import { brazilDateKey, brazilDayBounds, brazilDateTime, BRAZIL_TIME_ZONE } from "@/lib/timezone";
import { filterActiveAppointments, isCancellationMarker } from "@/lib/availability";
import { useFaturamentoTotais, type Periodo } from "@/hooks/use-faturamento-totais";
import { CaixaRelatorioRepasse } from "@/painel/CaixaRelatorioRepasse";

const CARDS: { key: Periodo; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mês" },
  { key: "ano", label: "Este ano" },
];

const PAYMENT_METHODS: { id: "dinheiro" | "pix" | "cartao"; label: string }[] = [
  { id: "dinheiro", label: "Dinheiro" },
  { id: "pix", label: "Pix" },
  { id: "cartao", label: "Cartão" },
];

function keyOfDay(y: number, m0: number, d: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function bearerToken(): Promise<string | undefined> {
  const session = (await supabase.auth.getSession()).data.session;
  return session?.access_token;
}

export function CaixaTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();

  const totaisHook = useFaturamentoTotais(barber);

  const [dayOffset, setDayOffset] = useState(0);
  const selectedDate = useMemo(() => {
    const [y, m, d] = brazilDateKey().split("-").map(Number);
    const base = new Date(y, m - 1, d);
    base.setDate(base.getDate() + dayOffset);
    return base;
  }, [dayOffset]);
  const dayKey = keyOfDay(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());

  const barbeiros = totaisHook.barbeiros;
  const barbeiroIds = useMemo(() => barbeiros.map((b) => b.id), [barbeiros]);
  const barbeiroNome = useMemo(() => new Map(barbeiros.map((b) => [b.id, b.name])), [barbeiros]);

  const servicosPorBarbeiro = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of totaisHook.servicosMap.values()) {
      if (!s.barber_id) continue;
      const list = m.get(s.barber_id) ?? [];
      list.push(s);
      m.set(s.barber_id, list);
    }
    return m;
  }, [totaisHook.servicosMap]);

  const diaQ = useQuery({
    queryKey: ["caixa-dia", barber.barbershop_id ?? barber.id, dayKey],
    enabled: barbeiroIds.length > 0,
    queryFn: async () => {
      const { start, end } = brazilDayBounds(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
      );
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .in("barber_id", barbeiroIds)
        .gte("appointment_time", start.toISOString())
        .lte("appointment_time", end.toISOString())
        .order("appointment_time", { ascending: true });
      if (error) throw error;
      return data as Appointment[];
    },
  });

  const itensDoDia = useMemo(
    () =>
      filterActiveAppointments(diaQ.data ?? []).filter(
        (a) => !isCancellationMarker(a) && (a.status || "").trim().toLowerCase() !== "cancelado",
      ),
    [diaQ.data],
  );

  const markPaid = useMutation({
    mutationFn: async ({
      appointmentId,
      method,
    }: {
      appointmentId: string;
      method: "dinheiro" | "pix" | "cartao";
    }) => {
      const token = await bearerToken();
      await postPublicApi(
        "/api/public/caixa-mark-paid",
        { appointment_id: appointmentId, payment_method: method },
        token,
      );
    },
    onSuccess: () => {
      toast.success("Marcado como pago");
      qc.invalidateQueries({ queryKey: ["caixa-dia"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [relatorioOpen, setRelatorioOpen] = useState(false);

  const deleteWalkin = useMutation({
    mutationFn: async (appointmentId: string) => {
      const token = await bearerToken();
      await postPublicApi("/api/public/caixa-walkin-delete", { appointment_id: appointmentId }, token);
    },
    onSuccess: () => {
      toast.success("Atendimento avulso excluído");
      qc.invalidateQueries({ queryKey: ["caixa-dia"] });
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLoading = totaisHook.isLoading || diaQ.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Caixa</h2>
        <Button variant="outline" size="sm" onClick={() => setRelatorioOpen(true)}>
          <FileText className="mr-1 size-4" /> Relatório de repasse
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.key} className="surface flex flex-col items-center gap-1 p-3 text-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</span>
            <span className="brand-text text-xl font-bold">{brl(totaisHook.totais[c.key].valor)}</span>
            <span className="text-xs text-muted-foreground">
              {totaisHook.totais[c.key].qtd} atendimento{totaisHook.totais[c.key].qtd === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>

      <div className="surface flex items-center justify-between p-3">
        <Button variant="ghost" size="icon" onClick={() => setDayOffset((v) => v - 1)}>
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{DIAS_SEMANA[selectedDate.getDay()]}</p>
          <p className="font-semibold">
            {selectedDate.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              timeZone: BRAZIL_TIME_ZONE,
            })}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setDayOffset((v) => v + 1)}>
          <ChevronRight />
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Atendimentos do dia
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-1 size-4" /> Novo atendimento
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" />
        </div>
      ) : itensDoDia.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Nenhum atendimento neste dia.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {itensDoDia.map((a) => {
            const isWalkIn = !!a.is_walk_in;
            const valor = a.service_price_snapshot ?? totaisHook.servicosMap.get(a.service_id)?.price ?? 0;
            return (
              <div key={a.id} className="surface flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 text-xl font-bold tabular-nums">
                      {fmtTime(a.appointment_time)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{a.customer_name}</p>
                        <PaymentBadge status={a.payment_status} compact />
                        {isWalkIn && (
                          <span className="inline-flex items-center rounded-full border border-[color:var(--brand-from)]/40 bg-[color:var(--brand-from)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-from)]">
                            Avulso
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {totaisHook.servicosMap.get(a.service_id)?.name ?? "Serviço"} ·{" "}
                        {barbeiroNome.get(a.barber_id) ?? "Barbeiro"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xl font-bold tabular-nums">{brl(valor)}</span>
                    {isWalkIn && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            setEditing(a);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          onClick={() => setDeleting(a)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {a.payment_status === "pendente" && (
                  <div className="flex flex-wrap justify-center gap-2 border-t border-border/50 pt-3">
                    {PAYMENT_METHODS.map((m) => (
                      <Button
                        key={m.id}
                        variant="outline"
                        size="sm"
                        disabled={markPaid.isPending}
                        onClick={() => markPaid.mutate({ appointmentId: a.id, method: m.id })}
                      >
                        {m.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <WalkinDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        barbeiros={barbeiros}
        servicosPorBarbeiro={servicosPorBarbeiro}
        selectedDate={selectedDate}
        editing={editing}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["caixa-dia"] });
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir atendimento avulso?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove o lançamento de {deleting?.customer_name} do Caixa. Essa ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWalkin.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteWalkin.isPending}
              onClick={() => deleting && deleteWalkin.mutate(deleting.id)}
            >
              {deleteWalkin.isPending ? <Loader2 className="size-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={relatorioOpen} onOpenChange={setRelatorioOpen}>
        <DialogContent showCloseButton={false} className="overflow-visible sm:max-w-2xl">
          <DialogClose className="absolute left-1/2 top-0 flex size-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] items-center justify-center rounded-full border border-border bg-background shadow-md ring-offset-background transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="size-5" />
            <span className="sr-only">Fechar</span>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>Relatório de repasse</DialogTitle>
            <DialogDescription>
              Total a repassar por barbeiro, separado por origem do pagamento.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-y-auto">
            {relatorioOpen && <CaixaRelatorioRepasse barber={barber} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function localDateTimeValue(date: Date, time?: string): string {
  const key = keyOfDay(date.getFullYear(), date.getMonth(), date.getDate());
  const hhmm =
    time ??
    new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: BRAZIL_TIME_ZONE,
      hour12: false,
    });
  return `${key}T${hhmm}`;
}

function WalkinDialog({
  open,
  onOpenChange,
  barbeiros,
  servicosPorBarbeiro,
  selectedDate,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbeiros: Barber[];
  servicosPorBarbeiro: Map<string, Service[]>;
  selectedDate: Date;
  editing: Appointment | null;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [barberId, setBarberId] = useState(editing?.barber_id ?? "");
  const [serviceId, setServiceId] = useState(editing?.service_id ?? "");
  const [nome, setNome] = useState(editing?.customer_name ?? "");
  const [preco, setPreco] = useState(String(editing?.service_price_snapshot ?? ""));
  const [quando, setQuando] = useState(
    editing
      ? localDateTimeValue(new Date(editing.appointment_time), fmtTime(editing.appointment_time))
      : localDateTimeValue(selectedDate),
  );

  // Reabre o formulário do zero a cada vez (criar ou editar outro registro).
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = editing?.id ?? "novo";
  if (open && openedFor !== key) {
    setOpenedFor(key);
    setBarberId(editing?.barber_id ?? "");
    setServiceId(editing?.service_id ?? "");
    setNome(editing?.customer_name ?? "");
    setPreco(String(editing?.service_price_snapshot ?? ""));
    setQuando(
      editing
        ? localDateTimeValue(new Date(editing.appointment_time), fmtTime(editing.appointment_time))
        : localDateTimeValue(selectedDate),
    );
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const servicos = barberId ? (servicosPorBarbeiro.get(barberId) ?? []) : [];

  const save = useMutation({
    mutationFn: async () => {
      const token = await bearerToken();
      const [datePart, timePart] = quando.split("T");
      const [y, m, d] = datePart.split("-").map(Number);
      const appointment_time = brazilDateTime(new Date(y, m - 1, d), timePart).toISOString();
      const body = {
        barber_id: barberId,
        service_id: serviceId,
        customer_name: nome.trim(),
        price: Number(preco.replace(",", ".")) || 0,
        appointment_time,
      };
      if (isEdit) {
        await postPublicApi("/api/public/caixa-walkin-update", { appointment_id: editing!.id, ...body }, token);
      } else {
        await postPublicApi("/api/public/caixa-walkin-create", body, token);
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Atendimento avulso atualizado" : "Atendimento avulso registrado");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const podeSalvar = !!barberId && !!serviceId && nome.trim().length > 0 && !!quando;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar atendimento avulso" : "Novo atendimento avulso"}</DialogTitle>
          <DialogDescription>
            Cliente atendido no balcão, sem passar pelo app. Já entra como pago e não ocupa o
            horário na agenda.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Barbeiro
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={barberId}
              onChange={(e) => {
                setBarberId(e.target.value);
                setServiceId("");
                setPreco("");
              }}
            >
              <option value="">Selecione um barbeiro</option>
              {barbeiros.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted-foreground">
            Serviço
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={serviceId}
              disabled={!barberId}
              onChange={(e) => {
                setServiceId(e.target.value);
                const s = servicos.find((x) => x.id === e.target.value);
                if (s) setPreco(String(s.price));
              }}
            >
              <option value="">Selecione um serviço</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted-foreground">
            Nome do cliente
            <Input value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Valor cobrado
              <Input
                inputMode="decimal"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                placeholder="0,00"
              />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Data e hora
              <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
            </label>
          </div>
        </div>

        <Button
          className="mt-2 w-full"
          variant="hero"
          disabled={!podeSalvar || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : isEdit ? "Salvar alterações" : "Registrar atendimento"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

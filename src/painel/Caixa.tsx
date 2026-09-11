import { Fragment, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";

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

// Nunca descarta um id que não resolveu (serviço apagado do catálogo depois
// de usado) — senão "Corte + Pezinho" vira só "Pezinho" quando um dos dois
// some do mapa de serviços.
function serviceNameListOf(a: Appointment, servicosMap: Map<string, Service>): string[] {
  const ids = a.service_ids?.length ? a.service_ids : [a.service_id];
  return ids.map((id) => servicosMap.get(id)?.name ?? "Serviço removido");
}

function serviceNamesOf(a: Appointment, servicosMap: Map<string, Service>): string {
  return serviceNameListOf(a, servicosMap).join(" + ");
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

  // Agrupa "serviço extra" (is_walk_in=true + parent_appointment_id) logo
  // abaixo do agendamento original, em vez de espalhado na lista.
  const { rowsToRender, childrenByParent } = useMemo(() => {
    const topLevel = itensDoDia.filter((a) => !a.parent_appointment_id);
    const topLevelIds = new Set(topLevel.map((a) => a.id));
    const children = new Map<string, Appointment[]>();
    for (const a of itensDoDia) {
      if (a.parent_appointment_id && topLevelIds.has(a.parent_appointment_id)) {
        const list = children.get(a.parent_appointment_id) ?? [];
        list.push(a);
        children.set(a.parent_appointment_id, list);
      }
    }
    // Se por algum motivo o "pai" não está na lista do dia, mostra o extra
    // como uma linha normal em vez de escondê-lo.
    const orphanExtras = itensDoDia.filter(
      (a) => a.parent_appointment_id && !topLevelIds.has(a.parent_appointment_id),
    );
    return { rowsToRender: [...topLevel, ...orphanExtras], childrenByParent: children };
  }, [itensDoDia]);

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
  const [addServiceTo, setAddServiceTo] = useState<Appointment | null>(null);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
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

  const cancelAppointment = useMutation({
    mutationFn: async (appointmentId: string) => {
      const token = await bearerToken();
      return postPublicApi<{ was_paid?: boolean }>(
        "/api/public/caixa-appointment-cancel",
        { appointment_id: appointmentId },
        token,
      );
    },
    onSuccess: (result) => {
      if (result?.was_paid) {
        toast.warning("Agendamento cancelado", {
          description: "Já estava pago online — providencie o estorno pelo Mercado Pago manualmente, se necessário.",
          duration: 8000,
        });
      } else {
        toast.success("Agendamento cancelado");
      }
      qc.invalidateQueries({ queryKey: ["caixa-dia"] });
      setCancelling(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLoading = totaisHook.isLoading || diaQ.isLoading;

  function valorDe(x: Appointment) {
    return x.service_price_snapshot ?? totaisHook.servicosMap.get(x.service_id)?.price ?? 0;
  }

  function renderRow(a: Appointment, kids: Appointment[]) {
    const isWalkIn = !!a.is_walk_in;
    const isExtra = isWalkIn && !!a.parent_appointment_id;
    const valor = valorDe(a);
    const total = valor + kids.reduce((sum, k) => sum + valorDe(k), 0);
    const tagLabel = isExtra ? "Serviço extra" : isWalkIn ? "Avulso" : null;
    const tagBadge = tagLabel && (
      <span className="inline-flex items-center rounded-full border border-[color:var(--brand-from)]/40 bg-[color:var(--brand-from)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-from)]">
        {tagLabel}
      </span>
    );
    const actionButtons = isWalkIn ? (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => {
            setEditing(a);
            setAddServiceTo(null);
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
    ) : (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => {
            setAddServiceTo(a);
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive"
          onClick={() => setCancelling(a)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </>
    );

    // Cada linha pendente (o atendimento original e/ou cada serviço extra)
    // resolve o próprio pagamento separadamente — o original pode já estar
    // pago enquanto o extra ainda não.
    const pendingLines = [a, ...kids].filter((x) => x.payment_status === "pendente");

    return (
      <div key={a.id} className="surface flex flex-col gap-2 p-3 sm:gap-3 sm:p-4">
        {/* Cabeçalho — mesmo formato pra avulso, serviço extra e agendamento do app. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">{fmtTime(a.appointment_time)}</span>
              <p className="truncate font-medium">{a.customer_name}</p>
              {tagBadge}
            </div>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              {barbeiroNome.get(a.barber_id) ?? "Barbeiro"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">{actionButtons}</div>
        </div>

        {/* Linhas de serviço (original + extras) num grid só, pra todos os
            valores ficarem alinhados na mesma coluna, com o Total no rodapé.
            Sem ícones por linha — toda edição passa pelo cabeçalho. */}
        <div className="overflow-hidden rounded-lg border border-border/60">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-2 gap-y-1.5 bg-secondary/30 px-3 py-2 text-sm">
            <div className="min-w-0">
              {serviceNameListOf(a, totaisHook.servicosMap).map((nome, i) => (
                <p key={i} className="break-words">
                  {nome}
                </p>
              ))}
            </div>
            <PaymentBadge status={a.payment_status} compact />
            <span className="text-right font-medium tabular-nums">{brl(valor)}</span>

            {kids.map((k) => (
              <Fragment key={k.id}>
                <div className="min-w-0 text-muted-foreground">
                  {serviceNameListOf(k, totaisHook.servicosMap).map((nome, i) => (
                    <p key={i} className="break-words">
                      {i === 0 ? "+ " : ""}
                      {nome}
                    </p>
                  ))}
                </div>
                <PaymentBadge status={k.payment_status} compact />
                <span className="text-right font-medium tabular-nums">{brl(valorDe(k))}</span>
              </Fragment>
            ))}
          </div>
          <div className="flex items-center justify-between bg-[color:var(--brand-from)]/10 px-3 py-2">
            <span className="text-sm font-semibold">Total</span>
            <span className="text-sm font-bold tabular-nums">{brl(total)}</span>
          </div>
        </div>

        {pendingLines.length > 0 && (
          <div className="space-y-2 sm:border-t sm:border-border/50 sm:pt-3">
            {pendingLines.map((line) => (
              <div key={line.id} className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">
                  Confirmar pagamento de "{serviceNamesOf(line, totaisHook.servicosMap)}":
                </p>
                <div className="flex flex-wrap gap-2 sm:justify-center">
                  {PAYMENT_METHODS.map((m) => (
                    <Button
                      key={m.id}
                      variant="outline"
                      size="sm"
                      disabled={markPaid.isPending}
                      onClick={() => markPaid.mutate({ appointmentId: line.id, method: m.id })}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

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
          <div className="surface flex flex-col gap-1 p-3 sm:items-center sm:text-center" key={c.key}>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground sm:text-xs">
              {c.label}
            </span>
            <span className="brand-text text-xl font-bold">{brl(totaisHook.totais[c.key].valor)}</span>
            <span className="text-[10px] text-muted-foreground sm:text-xs">
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
            setAddServiceTo(null);
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
      ) : rowsToRender.length === 0 ? (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Nenhum atendimento neste dia.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:gap-3">
          {rowsToRender.map((a) => renderRow(a, childrenByParent.get(a.id) ?? []))}
        </div>
      )}

      <WalkinDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditing(null);
            setAddServiceTo(null);
          }
        }}
        barbeiros={barbeiros}
        servicosPorBarbeiro={servicosPorBarbeiro}
        selectedDate={selectedDate}
        editing={editing}
        addServiceTo={addServiceTo}
        existingExtras={addServiceTo ? (childrenByParent.get(addServiceTo.id) ?? []) : []}
        servicosMap={totaisHook.servicosMap}
        onListChanged={() => qc.invalidateQueries({ queryKey: ["caixa-dia"] })}
        onSaved={() => {
          setFormOpen(false);
          setEditing(null);
          setAddServiceTo(null);
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

      <AlertDialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O agendamento de {cancelling?.customer_name} fica marcado como cancelado (continua no
              histórico) e o horário é liberado na agenda.
              {cancelling?.payment_status === "pago" && (
                <span className="mt-2 block font-medium text-destructive">
                  Esse agendamento já foi pago online — providencie o estorno pelo Mercado Pago
                  manualmente, se necessário.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelAppointment.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelAppointment.isPending}
              onClick={() => cancelling && cancelAppointment.mutate(cancelling.id)}
            >
              {cancelAppointment.isPending ? <Loader2 className="size-4 animate-spin" /> : "Cancelar agendamento"}
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
  servicosMap,
  selectedDate,
  editing,
  addServiceTo,
  existingExtras,
  onListChanged,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbeiros: Barber[];
  servicosPorBarbeiro: Map<string, Service[]>;
  servicosMap: Map<string, Service>;
  selectedDate: Date;
  editing: Appointment | null;
  /** Agendamento (do app ou avulso) ao qual serviços extras podem ser adicionados/removidos. */
  addServiceTo: Appointment | null;
  /** Serviços extras já vinculados a `addServiceTo`, pra listar e permitir remover. */
  existingExtras: Appointment[];
  /** Avisa que a lista mudou (adicionou/removeu um extra) sem fechar o modal. */
  onListChanged: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const isAddService = !isEdit && !!addServiceTo;
  const lockedFields = isAddService;

  function initialState() {
    const base = editing ?? addServiceTo;
    return {
      barberId: base?.barber_id ?? "",
      serviceIds: isAddService ? [] : base?.service_ids?.length ? base.service_ids : base ? [base.service_id] : [],
      nome: base?.customer_name ?? "",
      preco: isAddService ? "" : String(base?.service_price_snapshot ?? ""),
      quando: base
        ? localDateTimeValue(new Date(base.appointment_time), fmtTime(base.appointment_time))
        : localDateTimeValue(selectedDate),
    };
  }

  const [barberId, setBarberId] = useState(() => initialState().barberId);
  const [serviceIds, setServiceIds] = useState<string[]>(() => initialState().serviceIds);
  const [nome, setNome] = useState(() => initialState().nome);
  const [preco, setPreco] = useState(() => initialState().preco);
  const [quando, setQuando] = useState(() => initialState().quando);
  // Só usado ao criar um avulso novo — editar e adicionar serviço não mexem
  // no status inicial de pagamento.
  const [statusInicial, setStatusInicial] = useState<"pago" | "pendente">("pago");

  // Reabre o formulário do zero a cada vez (criar, editar ou adicionar serviço a outro registro).
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = editing ? `edit:${editing.id}` : addServiceTo ? `add:${addServiceTo.id}` : "novo";
  if (open && openedFor !== key) {
    setOpenedFor(key);
    const s = initialState();
    setBarberId(s.barberId);
    setServiceIds(s.serviceIds);
    setNome(s.nome);
    setPreco(s.preco);
    setQuando(s.quando);
    setStatusInicial("pago");
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
        service_ids: serviceIds,
        customer_name: nome.trim(),
        price: Number(preco.replace(",", ".")) || 0,
        appointment_time,
      };
      if (isEdit) {
        await postPublicApi("/api/public/caixa-walkin-update", { appointment_id: editing!.id, ...body }, token);
      } else if (isAddService) {
        await postPublicApi(
          "/api/public/caixa-walkin-create",
          { ...body, parent_appointment_id: addServiceTo!.id },
          token,
        );
      } else {
        await postPublicApi(
          "/api/public/caixa-walkin-create",
          { ...body, payment_status: statusInicial },
          token,
        );
      }
    },
    onSuccess: () => {
      if (isAddService) {
        // Fica no modal — o admin pode querer remover outro extra ou
        // adicionar mais um em seguida. Só a lista é atualizada.
        toast.success("Serviço extra adicionado");
        setServiceIds([]);
        setPreco("");
        onListChanged();
        return;
      }
      toast.success(isEdit ? "Atendimento avulso atualizado" : "Atendimento avulso registrado");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeExtra = useMutation({
    mutationFn: async (appointmentId: string) => {
      const token = await bearerToken();
      await postPublicApi("/api/public/caixa-walkin-delete", { appointment_id: appointmentId }, token);
    },
    onSuccess: () => {
      toast.success("Serviço extra removido");
      onListChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const podeSalvar = !!barberId && serviceIds.length > 0 && nome.trim().length > 0 && !!quando;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEdit ? "Editar atendimento avulso" : isAddService ? "Adicionar serviço" : "Novo atendimento avulso"}
          </DialogTitle>
          <DialogDescription>
            {isAddService
              ? "Serviços extras pedidos na hora neste agendamento — ficam pendentes, separados do que já foi pago, e você resolve pelo Caixa."
              : "Cliente atendido no balcão, sem passar pelo app. Já entra como pago e não ocupa o horário na agenda."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          {lockedFields ? (
            <div className="surface grid gap-1 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Barbeiro:</span>{" "}
                <span className="font-medium">
                  {barbeiros.find((b) => b.id === barberId)?.name ?? "—"}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Cliente:</span>{" "}
                <span className="font-medium">{nome}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Horário:</span>{" "}
                <span className="font-medium">{fmtTime(addServiceTo!.appointment_time)}</span>
              </p>
            </div>
          ) : (
            <>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Barbeiro
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  value={barberId}
                  onChange={(e) => {
                    setBarberId(e.target.value);
                    setServiceIds([]);
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
                Nome do cliente
                <Input value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
              </label>
            </>
          )}

          {isAddService && existingExtras.length > 0 && (
            <div className="grid gap-1 text-xs text-muted-foreground">
              Extras já adicionados
              <div className="grid gap-1.5">
                {existingExtras.map((extra) => (
                  <div
                    key={extra.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      {serviceNameListOf(extra, servicosMap).map((n, i) => (
                        <p key={i} className="truncate text-foreground">
                          {n}
                        </p>
                      ))}
                      <p className="text-[11px] text-muted-foreground">
                        {extra.payment_status === "pago" ? "Pago" : "Pendente"} ·{" "}
                        {brl(extra.service_price_snapshot ?? servicosMap.get(extra.service_id)?.price ?? 0)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-destructive"
                      disabled={removeExtra.isPending}
                      onClick={() => removeExtra.mutate(extra.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1 text-xs text-muted-foreground">
            {isAddService ? "Adicionar novo serviço" : "Serviço (pode escolher mais de um)"}
            <div className="grid grid-cols-1 gap-2">
              {servicos.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {barberId ? "Esse barbeiro não tem serviços cadastrados." : "Selecione um barbeiro primeiro."}
                </p>
              )}
              {servicos.map((s) => {
                const selected = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setServiceIds((current) => {
                        const next = current.includes(s.id)
                          ? current.filter((id) => id !== s.id)
                          : [...current, s.id];
                        const total = next.reduce(
                          (sum, id) => sum + (servicos.find((x) => x.id === id)?.price ?? 0),
                          0,
                        );
                        setPreco(String(total));
                        return next;
                      })
                    }
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition",
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card/60 text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    <span>{s.name}</span>
                    <span className="shrink-0 font-semibold">{brl(s.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={cn("grid gap-3", lockedFields ? "grid-cols-1" : "grid-cols-2")}>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Valor cobrado
              <Input
                inputMode="decimal"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                placeholder="0,00"
              />
            </label>
            {!lockedFields && (
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Data e hora
                <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
              </label>
            )}
          </div>

          {!isEdit && !isAddService && (
            <div className="grid gap-1 text-xs text-muted-foreground">
              Status inicial
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "pago", label: "Pago" },
                    { id: "pendente", label: "Pendente" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStatusInicial(opt.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-center text-sm font-medium transition",
                      statusInicial === opt.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card/60 text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {statusInicial === "pendente" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Aparece na lista com os botões Dinheiro/Pix/Cartão pra confirmar o pagamento depois.
                </p>
              )}
            </div>
          )}
        </div>

        <Button
          className="mt-2 w-full shrink-0"
          variant="hero"
          disabled={!podeSalvar || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="animate-spin" />
          ) : isEdit ? (
            "Salvar alterações"
          ) : isAddService ? (
            "Adicionar serviço"
          ) : (
            "Registrar atendimento"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

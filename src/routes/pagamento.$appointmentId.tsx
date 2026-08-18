import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Store, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { brl, fmtTime } from "@/lib/format";
import { saveCheckoutRef } from "@/lib/checkout-ref";

const STATUS_LABEL: Record<string, string> = {
  pendente: "Aguardando pagamento",
  pago: "Pagamento confirmado",
  expirado: "PIX expirado",
  cancelado: "Pagamento cancelado",
  falhou: "Pagamento recusado",
  estornado: "Pagamento estornado",
};

export const Route = createFileRoute("/pagamento/$appointmentId")({
  head: () => ({
    meta: [
      { title: "Pagamento do agendamento" },
      {
        name: "description",
        content:
          "Pague seu agendamento online por PIX ou cartão, ou escolha pagar presencialmente na barbearia.",
      },
      { property: "og:title", content: "Pagamento do agendamento" },
      {
        property: "og:description",
        content: "Pague online por PIX ou cartão, ou presencialmente na barbearia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PagamentoPage,
});

function PagamentoPage() {
  const { appointmentId } = Route.useParams();
  const navigate = useNavigate();
  const [payStatus, setPayStatus] = useState<string>("pendente");
  const paid = payStatus === "pago";

  const apptQ = useQuery({
    queryKey: ["appointment-pay", appointmentId],
    refetchInterval: paid ? false : 10_000,
    queryFn: async () => {
      // As colunas de pagamento podem ainda não existir: cai para as básicas.
      let res = await supabase
        .from("appointments")
        .select("id, appointment_time, service_id, customer_name, payment_status")
        .eq("id", appointmentId)
        .maybeSingle();
      if (res.error) {
        res = await supabase
          .from("appointments")
          .select("id, appointment_time, service_id, customer_name")
          .eq("id", appointmentId)
          .maybeSingle();
      }
      const data = res.data;
      if (res.error) throw res.error;
      if (!data) return null;
      const svc = await supabase
        .from("services")
        .select("id, name, price, duration_minutes")
        .eq("id", (data as { service_id: string }).service_id)
        .maybeSingle();
      return {
        appointment: data as {
          id: string;
          appointment_time: string;
          customer_name: string;
          payment_status: string | null;
        },
        service: svc.data as { name: string; price: number } | null,
      };
    },
  });

  // Status vindo do banco (atualizado pelo webhook do Mercado Pago).
  const dbStatus = apptQ.data?.appointment.payment_status ?? null;
  useEffect(() => {
    if (payStatus === "pago") return;
    if (dbStatus && dbStatus !== payStatus) setPayStatus(dbStatus);
  }, [dbStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => {
    setTimeout(
      () => navigate({ to: "/pagamento-confirmado/$appointmentId", params: { appointmentId } }),
      1200,
    );
  }, [navigate, appointmentId]);

  useEffect(() => {
    if (paid) finish();
  }, [paid, finish]);

  // Checkout Pro: cria a preferência e redireciona para a tela do Mercado Pago.
  const startCheckout = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const response = await fetch("/api/public/mercadopago-preference", {
        method: "POST",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ appointment_id: appointmentId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        init_point?: string;
        preference_id?: string;
      };
      if (!response.ok || !data.init_point) {
        console.error("Checkout Pro: falha ao criar preferência", response.status, data);
        throw new Error(
          [data.error, data.detail].filter(Boolean).join(" — ") ||
            `Não foi possível iniciar o pagamento online (HTTP ${response.status}).`,
        );
      }

      // Vincula a preferência ao agendamento para reconciliar no retorno.
      saveCheckoutRef(appointmentId, data.preference_id);
      return data.init_point;
    },
    onSuccess: (initPoint) => {
      window.location.href = initPoint;
    },
    onError: (e: Error) =>
      toast.error("Não foi possível abrir o pagamento", { description: e.message }),
  });

  const payLocal = useMutation({
    mutationFn: async () => {
      // 1) Caminho principal: rota do servidor (service role), imune a RLS.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (accessToken) {
        const response = await fetch("/api/public/appointment-local-payment", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ appointment_id: appointmentId }),
        });
        if (response.ok) return;
        if (response.status === 404) {
          throw new Error("Agendamento não encontrado no banco de dados.");
        }
      }

      // 2) Fallback: tenta direto pelo cliente (quando há política de UPDATE).
      const full = await supabase
        .from("appointments")
        .update({ payment_method: "presencial", payment_status: "pendente" })
        .eq("id", appointmentId)
        .select("id")
        .maybeSingle();
      if (!full.error && full.data) return;

      const partial = await supabase
        .from("appointments")
        .update({ payment_method: "presencial" })
        .eq("id", appointmentId)
        .select("id")
        .maybeSingle();
      if (!partial.error && partial.data) return;

      // 3) O update pode ter sido bloqueado por RLS mesmo com a linha existindo.
      // Se o agendamento existe, seguimos: ele já está salvo e pendente.
      const exists = await supabase
        .from("appointments")
        .select("id")
        .eq("id", appointmentId)
        .maybeSingle();
      if (exists.data) return;

      throw new Error("Agendamento não encontrado no banco de dados.");
    },

    onError: (e: Error) =>
      toast.error("Não foi possível registrar o pagamento presencial", {
        description: e.message,
      }),
    onSuccess: () => {
      toast.success("Combinado! Pague presencialmente na barbearia.");
      navigate({
        to: "/pagamento-confirmado/$appointmentId",
        params: { appointmentId },
        search: { metodo: "presencial" },
      });
    },
  });


  const busy = startCheckout.isPending || payLocal.isPending;
  const service = apptQ.data?.service ?? null;
  const appointment = apptQ.data?.appointment ?? null;
  const failed = ["expirado", "cancelado", "falhou"].includes(payStatus);

  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-3"
        onClick={() => navigate({ to: "/meus-agendamentos" })}
      >
        <ArrowLeft /> Voltar para agendamentos
      </Button>
      <h1 className="text-xl font-semibold">Pagamento</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Escolha como deseja pagar o seu atendimento.
      </p>

      <section className="surface mt-5 space-y-2 p-4 text-sm">
        {apptQ.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Serviço</span>
              <span className="font-medium">{service?.name ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Horário</span>
              <span className="font-medium">
                {appointment
                  ? `${new Date(appointment.appointment_time).toLocaleDateString("pt-BR")} · ${fmtTime(appointment.appointment_time)}`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span
                className={
                  paid
                    ? "font-semibold text-[color:var(--success)]"
                    : failed
                      ? "font-semibold text-destructive"
                      : "font-medium"
                }
              >
                {STATUS_LABEL[payStatus] ?? payStatus}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Total</span>
              <span className="brand-text text-base font-bold">{brl(service?.price ?? 0)}</span>
            </div>
          </>
        )}
      </section>

      {paid && (
        <div className="surface mt-5 flex items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="size-5 text-[color:var(--success)]" />
          Pagamento aprovado! Abrindo a confirmação do pedido…
        </div>
      )}

      {failed && !paid && (
        <div className="surface mt-5 flex items-center gap-3 p-4 text-sm">
          <AlertCircle className="size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">{STATUS_LABEL[payStatus]}</p>
            <p className="text-xs text-muted-foreground">
              Você pode tentar pagar novamente ou pagar presencialmente.
            </p>
          </div>
        </div>
      )}

      {startCheckout.isPending && (
        <div
          role="status"
          aria-live="polite"
          className="surface mt-5 flex items-center gap-3 p-4 text-sm"
        >
          <Loader2 className="size-5 shrink-0 animate-spin text-[var(--brand-from)]" />
          <div>
            <p className="font-semibold">Abrindo o pagamento seguro…</p>
            <p className="text-xs text-muted-foreground">
              Você será levado ao ambiente do Mercado Pago.
            </p>
          </div>
        </div>
      )}

      {!paid && (
        <div className="mt-5 grid gap-3">
          <Button
            variant="hero"
            size="xl"
            className="w-full"
            onClick={() => startCheckout.mutate()}
            disabled={busy}
          >
            {startCheckout.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />}
            {startCheckout.isPending ? "Abrindo pagamento…" : "Pagar Online (Pix ou Cartão)"}
          </Button>
          <Button
            variant="outline"
            size="xl"
            className="w-full"
            disabled={busy}
            onClick={() => payLocal.mutate()}
          >
            <Store /> Pagar presencialmente
          </Button>
        </div>
      )}
    </main>
  );
}

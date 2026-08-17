import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, CalendarDays, ArrowLeft } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { readCheckoutRef, clearCheckoutRef } from "@/lib/checkout-ref";
import { Button } from "@/components/ui/button";
import { brl, fmtDate, fmtTime } from "@/lib/format";

const METHOD_LABEL: Record<string, string> = {
  pix: "PIX",
  card: "Cartão de crédito",
  cartao: "Cartão de crédito",
  credit_card: "Cartão de crédito",
  cartao_credito: "Cartão de crédito",
  debit_card: "Cartão de débito",
  cartao_debito: "Cartão de débito",
  online: "Online (PIX ou cartão)",
  presencial: "Presencial na barbearia",
};



export const Route = createFileRoute("/pagamento-confirmado/$appointmentId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    status?: string;
    payment_id?: string;
    collection_id?: string;
    collection_status?: string;
    merchant_order_id?: string;
    preference_id?: string;
  } => {
    const keys = [
      "status",
      "payment_id",
      "collection_id",
      "collection_status",
      "merchant_order_id",
      "preference_id",
    ] as const;
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = search[k];
      if (typeof v === "string" && v) out[k] = v;
    }
    return out;
  },

  head: () => ({
    meta: [
      { title: "Pagamento confirmado · Comprovante do agendamento" },
      {
        name: "description",
        content:
          "Confirmação do pagamento com resumo do valor pago e atalhos para voltar ao checkout ou ver seus agendamentos.",
      },
      { property: "og:title", content: "Pagamento confirmado" },
      {
        property: "og:description",
        content: "Veja o resumo do valor pago do seu agendamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfirmacaoPage,
});

function ConfirmacaoPage() {
  const { appointmentId } = Route.useParams();
  const search = Route.useSearch();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["appointment-confirmation", appointmentId],
    // A confirmação do gateway e a atualização do banco podem chegar com poucos
    // segundos de diferença. Continua consultando até refletir o pagamento.
    refetchInterval: (query) => {
      const row = query.state.data as
        | { appointment?: { payment_status?: string | null } }
        | undefined;
      return row?.appointment?.payment_status === "pago" ? false : 2000;
    },

    refetchOnMount: "always",
    queryFn: async () => {
      let res = await supabase
        .from("appointments")
        .select(
          "id, appointment_time, service_id, customer_name, payment_status, payment_method, paid_at, mp_payment_id",
        )
        .eq("id", appointmentId)
        .maybeSingle();
      if (res.error) {
        res = await supabase
          .from("appointments")
          .select("id, appointment_time, service_id, customer_name")
          .eq("id", appointmentId)
          .maybeSingle();
      }
      if (res.error) throw res.error;
      const data = res.data as
        | {
            id: string;
            appointment_time: string;
            service_id: string;
            customer_name: string | null;
            payment_status?: string | null;
            payment_method?: string | null;
            paid_at?: string | null;
            mp_payment_id?: string | null;
          }
        | null;
      if (!data) return null;
      const svc = await supabase
        .from("services")
        .select("name, price")
        .eq("id", data.service_id)
        .maybeSingle();
      return { appointment: data, service: svc.data as { name: string; price: number } | null };
    },
  });

  const appointment = q.data?.appointment ?? null;
  const service = q.data?.service ?? null;
  const storedPreferenceId = readCheckoutRef(appointmentId);

  // Status vindo da consulta em tempo real no Mercado Pago (mais rápido que o banco).
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Referência salva no próprio agendamento ("pref:<id>" ou id do pagamento).
  // Garante reconciliação mesmo se o usuário recarregar sem parâmetros na URL
  // ou abrir a tela em outro dispositivo (sem localStorage).
  const dbRef = appointment?.mp_payment_id ?? null;
  const dbPreferenceId = dbRef?.startsWith("pref:") ? dbRef.slice(5) : null;

  const returnedFromMp = Boolean(
    search.payment_id ||
      search.collection_id ||
      search.merchant_order_id ||
      search.preference_id ||
      search.status ||
      search.collection_status ||
      storedPreferenceId ||
      dbRef,
  );

  const status = liveStatus ?? appointment?.payment_status ?? null;
  const paid = status === "pago";
  const method = appointment?.payment_method ?? null;
  const isOnline = returnedFromMp || (method != null && method !== "presencial");
  const failedOnline =
    isOnline && ["expirado", "cancelado", "falhou", "estornado"].includes(status ?? "");

  // Ao voltar do Mercado Pago ("Voltar para a loja"), consulta o pagamento na API
  // oficial a cada 2s (por até 30s) até virar "pago" — sem esperar o webhook.
  const running = useRef(false);
  useEffect(() => {
    if (paid || !isOnline) return;
    let stop = false;
    const started = Date.now();
    const check = async () => {
      if (running.current || stop) return false;
      running.current = true;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return false;
        const res = await fetch("/api/public/mercadopago-reconcile", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            appointment_id: appointmentId,
            ...(search.payment_id || search.collection_id
              ? { payment_id: search.payment_id ?? search.collection_id }
              : {}),
            ...(search.merchant_order_id ? { merchant_order_id: search.merchant_order_id } : {}),
            ...(search.preference_id || storedPreferenceId || dbPreferenceId
              ? { preference_id: search.preference_id ?? storedPreferenceId ?? dbPreferenceId }
              : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { payment_status?: string };
        if (!stop && body.payment_status) {
          setLiveStatus(body.payment_status);
          void qc.invalidateQueries({ queryKey: ["appointment-confirmation", appointmentId] });
          return body.payment_status === "pago";
        }
      } catch {
        /* silencioso */
      } finally {
        running.current = false;
      }
      return false;
    };
    void check();
    const id = window.setInterval(() => {
      if (Date.now() - started > 30_000) {
        window.clearInterval(id);
        // Fallback: uma última consulta antes de avisar que ainda está processando.
        void check().then((ok) => {
          if (!stop && !ok) setTimedOut(true);
        });
        return;
      }
      void check();
    }, 2000);

    // Volta do Mercado Pago / troca de aba: força checagem imediata.
    const onWake = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      stop = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [
    paid,
    isOnline,
    appointmentId,
    search.payment_id,
    search.collection_id,
    search.merchant_order_id,
    search.preference_id,
    storedPreferenceId,
    qc,
  ]);


  // Pagamento confirmado: a referência da preferência não é mais necessária.
  useEffect(() => {
    if (paid) clearCheckoutRef(appointmentId);
  }, [paid, appointmentId]);



  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-8">
      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" />
        </div>
      ) : !appointment ? (
        <section className="surface p-5 text-center text-sm">
          <p className="font-medium">Agendamento não encontrado</p>
          <Button asChild variant="outline" className="mt-4 w-full">
            <Link to="/meus-agendamentos">Ver meus agendamentos</Link>
          </Button>
        </section>
      ) : (
        <>
          <div className="flex flex-col items-center text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-[color:var(--success)]/12">
              <CheckCircle2 className="size-9 text-[color:var(--success)]" />
            </span>
            <h1 className="mt-4 text-xl font-semibold">
              {paid ? "Pagamento confirmado!" : "Agendamento confirmado!"}
            </h1>
            <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {paid ? (
                "Pagamento realizado online com sucesso."
              ) : failedOnline ? (
                "Não conseguimos confirmar o seu pagamento online. Tente novamente no checkout."
              ) : isOnline && timedOut ? (
                "Ainda não recebemos a confirmação do Mercado Pago. Atualize a página em instantes."
              ) : isOnline ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Confirmando o seu pagamento online…
                </>
              ) : (
                "O pagamento será feito presencialmente na barbearia."
              )}
            </p>

          </div>

          <section className="surface mt-6 space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Serviço</span>
              <span className="font-medium">{service?.name ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cliente</span>
              <span className="font-medium">{appointment.customer_name ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Horário</span>
              <span className="font-medium">
                {fmtDate(appointment.appointment_time)} · {fmtTime(appointment.appointment_time)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Forma de pagamento</span>
              <span className="font-medium">
                {method ? (METHOD_LABEL[method] ?? method) : paid ? "Online" : "Presencial"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span
                className={
                  paid ? "font-semibold text-[color:var(--success)]" : "font-medium"
                }
              >
                {paid
                  ? "Pago"
                  : failedOnline
                    ? "Pagamento não confirmado"
                    : isOnline
                      ? "Confirmando pagamento…"
                      : "Aguardando pagamento"}

              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Valor total</span>
              <span className="brand-text text-base font-bold">{brl(service?.price ?? 0)}</span>
            </div>
          </section>

          <div className="mt-6 grid gap-3">
            <Button asChild variant="hero" size="xl" className="w-full">
              <Link to="/meus-agendamentos">
                <CalendarDays /> Ver meus agendamentos
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl" className="w-full">
              <Link to="/pagamento/$appointmentId" params={{ appointmentId }}>
                <ArrowLeft /> Voltar ao checkout
              </Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/">Agendar outro horário</Link>
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

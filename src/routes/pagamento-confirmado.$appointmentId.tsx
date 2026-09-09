import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, CalendarDays, ArrowLeft, AlertCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { postPublicApi } from "@/lib/api-fetch";
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
    metodo?: string;
  } => {
    const keys = [
      "status",
      "payment_id",
      "collection_id",
      "collection_status",
      "merchant_order_id",
      "preference_id",
      "metodo",
    ] as const;
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = search[k];
      // O parseSearch padrão do router faz JSON.parse em cada valor da URL:
      // "175027266929" (payment_id/collection_id/merchant_order_id do MP)
      // vira number, não string. Sem esse fallback, o valor era descartado
      // em silêncio e nunca chegava no body do reconcile.
      if (typeof v === "string" && v) out[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
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
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["appointment-confirmation", appointmentId],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    structuralSharing: false,
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

  // Uma confirmação em cache nunca pode reaparecer enquanto o SELECT atual
  // ainda não terminou.
  const confirmedData = q.isFetching ? undefined : q.data;
  const appointment = confirmedData?.appointment ?? null;
  const service = confirmedData?.service ?? null;
  // O estado visual vem exclusivamente da linha persistida em appointments.
  const [timedOut, setTimedOut] = useState(false);
  // Depois de tempo demais sem confirmação (provável checkout abandonado),
  // para de consultar o gateway e mostra um estado final com opção de tentar
  // de novo, em vez de ficar "confirmando" pra sempre.
  const [gaveUp, setGaveUp] = useState(false);

  // Referência salva no próprio agendamento ("pref:<id>" ou id do pagamento).
  // Garante reconciliação mesmo se o usuário recarregar sem parâmetros na URL
  // ou abrir a tela em outro dispositivo.
  const dbRef = appointment?.mp_payment_id ?? null;
  const dbPreferenceId = dbRef?.startsWith("pref:") ? dbRef.slice(5) : null;

  const returnedFromMp = Boolean(
    search.payment_id ||
      search.collection_id ||
      search.merchant_order_id ||
      search.preference_id ||
      search.status ||
      search.collection_status ||
      dbRef,
  );

  const status = appointment?.payment_status ?? null;
  const paid = status === "pago";
  const method = appointment?.payment_method ?? null;
  // Pagamento presencial: nunca consulta o gateway nem mostra "confirmando pagamento".
  const isPresencial = search.metodo === "presencial" || method === "presencial";
  const isOnline = !isPresencial && (returnedFromMp || (method != null && method !== "presencial"));
  const failedOnline =
    isOnline && ["expirado", "cancelado", "falhou", "estornado"].includes(status ?? "");

  // Fallback: mesmo sem nenhuma referência (mp_payment_id NULL e sem parâmetros na
  // URL), tentamos reconciliar assim que o agendamento carrega.
  // O servidor procura o pagamento pelo external_reference (id do agendamento),
  // então a tela nunca trava esperando um id que pode nunca ter sido salvo.
  // Também reconcilia quando a leitura do agendamento falha (RLS/anônimo):
  // o servidor encontra o pagamento pelo external_reference do agendamento.
  const shouldReconcile =
    !paid &&
    !failedOnline &&
    !isPresencial &&
    (isOnline || method == null || status == null || status === "pendente");

  // O webhook atualiza appointments e o Realtime entrega essa alteração à
  // tela imediatamente, sem esperar o próximo ciclo de polling.
  useEffect(() => {
    const channel = supabase
      .channel(`payment-confirmation:${appointmentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "appointments",
          filter: `id=eq.${appointmentId}`,
        },
        (payload) => {
          const changed = payload.new as {
            payment_status?: string | null;
            payment_method?: string | null;
            paid_at?: string | null;
            mp_payment_id?: string | null;
          };
          // Realtime é somente um gatilho: o conteúdo exibido é relido do banco.
          if (changed.payment_status || changed.mp_payment_id) {
            void qc.invalidateQueries({ queryKey: ["appointment-confirmation", appointmentId] });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [appointmentId, qc]);

  // Faz uma única reconciliação imediata ao voltar do Mercado Pago. Ela cobre o
  // caso raro em que o webhook ainda não chegou; depois disso o Realtime assume.
  const running = useRef(false);
  useEffect(() => {
    if (paid || !shouldReconcile) return;

    setTimedOut(false);
    setGaveUp(false);
    let stop = false;
    let gaveUpLocal = false;
    const timers: { interval?: number; timeout?: number; giveUp?: number } = {};

    // Chamado quando fica claro que não há nada a esperar (nenhum pagamento
    // foi sequer criado no Mercado Pago) — em vez de deixar a pessoa olhando
    // "Confirmando pagamento" até o timeout de segurança, já manda direto
    // pra tela de escolha, de onde ela pode tentar pagar de novo ou escolher
    // presencial. Nunca faz isso por causa de um PIX genuinamente pendente:
    // esse caso tem um pagamento real, só que ainda não aprovado.
    const bounceToCheckout = () => {
      stop = true;
      window.clearInterval(timers.interval);
      window.clearTimeout(timers.timeout);
      window.clearTimeout(timers.giveUp);
      void navigate({ to: "/pagamento/$appointmentId", params: { appointmentId } });
    };

    const check = async () => {
      if (running.current || stop) return false;
      running.current = true;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const body =
          (await postPublicApi<{ payment_status?: string; updated?: boolean; payment_found?: boolean }>(
            "/api/public/mercadopago-reconcile",
            {
              appointment_id: appointmentId,
              ...(search.payment_id || search.collection_id
                ? { payment_id: search.payment_id ?? search.collection_id }
                : {}),
              ...(search.merchant_order_id ? { merchant_order_id: search.merchant_order_id } : {}),
               ...(search.preference_id || dbPreferenceId
                 ? { preference_id: search.preference_id ?? dbPreferenceId }
                : {}),
            },
            token,
          )) ?? {};
        if (stop) return false;
        if (body.payment_found === false) {
          bounceToCheckout();
          return false;
        }
        // "updated" só vem true quando o reconcile de fato gravou algo novo no
        // banco. Um checkout abandonado (cliente voltou sem pagar) devolve
        // payment_status="pendente" só informativo, sem updated — invalidar a
        // busca nesse caso recarregava a tela a cada 2s pra sempre, sem nunca
        // haver nada de novo pra mostrar.
        if (body.updated) {
          // A reconciliação apenas provoca uma nova leitura. Nunca transforma a
          // resposta HTTP em sucesso visual; isso só ocorre pelo banco/Realtime.
          await qc.invalidateQueries({ queryKey: ["appointment-confirmation", appointmentId] });
          return false;
        }
      } catch {
        /* silencioso */
      } finally {
        running.current = false;
      }
      return false;
    };
    void check();
    // Rede de segurança: enquanto o Realtime não entregar a mudança, consulta
    // o gateway a cada 2s. Para assim que o status virar "pago".
    timers.interval = window.setInterval(() => {
      if (!stop) void check();
    }, 2000);
    timers.timeout = window.setTimeout(() => {
      if (!stop) setTimedOut(true);
    }, 30_000);
    // Rede de segurança adicional (conexão caiu, navegador travou, etc.):
    // mesmo sem a detecção acima, nunca fica "confirmando" pra sempre.
    timers.giveUp = window.setTimeout(() => {
      if (stop) return;
      gaveUpLocal = true;
      window.clearInterval(timers.interval);
      setGaveUp(true);
    }, 90_000);


    // Volta do Mercado Pago / troca de aba: força checagem imediata.
    const onWake = () => {
      if (!gaveUpLocal && !stop && document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      stop = true;
      window.clearInterval(timers.interval);
      window.clearTimeout(timers.timeout);
      window.clearTimeout(timers.giveUp);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [
    paid,
    shouldReconcile,
    appointmentId,
    search.payment_id,
    search.collection_id,
    search.merchant_order_id,
    search.preference_id,
    dbPreferenceId,
    qc,
    navigate,
  ]);


  useEffect(() => {
    if (!paid) return;
    void qc.invalidateQueries({ queryKey: ["my-appointments"] });
  }, [paid, appointmentId, qc]);




  // Estado de reconciliação persistente: aparece ao voltar do Mercado Pago e
  // permanece visível enquanto o polling consulta o status, sem travar a
  // navegação (os botões continuam clicáveis o tempo todo).
  const reconciling =
    !!appointment &&
    !paid &&
    !failedOnline &&
    !isPresencial &&
    !gaveUp &&
    (isOnline || method == null || status == null || status === "pendente");

  const waitingTooLong = reconciling && timedOut;
  // Tempo demais sem confirmação: trata como "não deu certo" pra efeito de
  // mensagem e botões, igual a um pagamento recusado — mas com um texto
  // honesto sobre o motivo mais provável (checkout abandonado).
  const notCompleted = failedOnline || gaveUp;

  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-8">
      {q.isLoading || q.isFetching ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" />
        </div>
      ) : !appointment ? (
        <section className="surface p-5 text-center text-sm">
          <p className="font-medium">Agendamento não encontrado</p>
          <Button asChild variant="outline" className="mt-4 w-full">
            <Link to="/meus-agendamentos" search={{ agendamento: appointmentId }}>Ver meus agendamentos</Link>
          </Button>
        </section>
      ) : reconciling ? (
        <>
          {/* Carregamento elegante e persistente */}
          <div className="flex flex-col items-center text-center">
            <span className="relative flex size-20 items-center justify-center">
              <span
                className="absolute inset-0 rounded-full bg-[color:var(--primary)]/25"
                style={{ animation: "pay-pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite" }}
              />
              <span
                className="relative flex size-16 items-center justify-center rounded-full bg-[color:var(--primary)]/12"
                style={{ animation: "pay-float 2.2s ease-in-out infinite" }}
              >
                <Loader2 className="size-8 animate-spin text-[color:var(--primary)]" />
              </span>
            </span>
            <h1 className="mt-5 text-xl font-semibold">
              {waitingTooLong
                ? "Quase lá…"
                : "Confirmando seu pagamento"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {waitingTooLong
                ? "A confirmação do Mercado Pago demorou um pouco mais. Já estamos verificando — você pode continuar navegando."
                : "Estamos validando seu pagamento com o Mercado Pago. Não saia da tela, isso leva apenas alguns segundos."}
            </p>

            {/* Barra de progresso com shimmer */}
            <div className="pay-shimmer-bar mt-5 h-2 w-full max-w-xs rounded-full bg-[color:var(--primary)]/12" />

            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[color:var(--success)]" />
              {waitingTooLong ? "Verificando em segundo plano…" : "Consultando o gateway de pagamento…"}
            </p>
          </div>

          {/* Resumo já visível durante o carregamento */}
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
              <span className="text-muted-foreground">Status</span>
              <span className="flex items-center gap-1.5 font-medium text-[color:var(--primary)]">
                <Loader2 className="size-3.5 animate-spin" />
                {waitingTooLong ? "Verificando…" : "Confirmando pagamento…"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Valor total</span>
              <span className="brand-text text-base font-bold">{brl(service?.price ?? 0)}</span>
            </div>
          </section>

          {/* Botões sempre disponíveis — a navegação nunca trava */}
          <div className="mt-6 grid gap-3">
            <Button asChild variant="hero" size="xl" className="w-full">
              <Link to="/meus-agendamentos" search={{ agendamento: appointmentId }}>
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
      ) : (
        <>
          <div className="flex flex-col items-center text-center">
            <span
              className={
                notCompleted
                  ? "flex size-16 items-center justify-center rounded-full bg-destructive/10"
                  : "flex size-16 items-center justify-center rounded-full bg-[color:var(--success)]/12"
              }
            >
              {notCompleted ? (
                <AlertCircle className="size-9 text-destructive" />
              ) : (
                <CheckCircle2 className="size-9 text-[color:var(--success)]" />
              )}
            </span>
            <h1 className="mt-4 text-xl font-semibold">
              {paid
                ? "Pagamento confirmado!"
                : notCompleted
                  ? "Pagamento não concluído"
                  : "Agendamento confirmado!"}
            </h1>
            <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {paid ? (
                "Pagamento realizado online com sucesso."
              ) : isPresencial ? (
                "Tudo certo! Você vai pagar presencialmente na barbearia."
              ) : gaveUp ? (
                "Não conseguimos confirmar esse pagamento — parece que o checkout foi fechado antes de concluir. Tente novamente ou escolha pagar presencialmente."
              ) : failedOnline ? (
                "Não conseguimos confirmar o seu pagamento online. Tente novamente no checkout."
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
                {isPresencial
                  ? "Presencial na barbearia"
                  : method
                    ? (METHOD_LABEL[method] ?? method)
                    : paid
                      ? "Online"
                      : "Presencial"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span
                className={
                  paid || isPresencial
                    ? "font-semibold text-[color:var(--success)]"
                    : notCompleted
                      ? "font-semibold text-destructive"
                      : "font-medium"
                }
              >
                {paid
                  ? "Pago"
                  : isPresencial
                    ? "Pagar na barbearia"
                    : notCompleted
                      ? "Pagamento não confirmado"
                      : "Aguardando pagamento"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Valor total</span>
              <span className="brand-text text-base font-bold">{brl(service?.price ?? 0)}</span>
            </div>
          </section>

          <div className="mt-6 grid gap-3">
            {notCompleted ? (
              <Button asChild variant="hero" size="xl" className="w-full">
                <Link to="/pagamento/$appointmentId" params={{ appointmentId }}>
                  <ArrowLeft /> Tentar pagar novamente
                </Link>
              </Button>
            ) : (
              <Button asChild variant="hero" size="xl" className="w-full">
                <Link to="/meus-agendamentos" search={{ agendamento: appointmentId }}>
                  <CalendarDays /> Ver meus agendamentos
                </Link>
              </Button>
            )}
            {notCompleted ? (
              <Button asChild variant="outline" size="xl" className="w-full">
                <Link to="/meus-agendamentos" search={{ agendamento: appointmentId }}>
                  <CalendarDays /> Ver meus agendamentos
                </Link>
              </Button>
            ) : paid ? null : (
              // Já pago não tem sentido "voltar ao checkout" — some pra não
              // parecer que ainda falta fazer alguma coisa.
              <Button asChild variant="outline" size="xl" className="w-full">
                <Link to="/pagamento/$appointmentId" params={{ appointmentId }}>
                  <ArrowLeft /> Voltar ao checkout
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" className="w-full">
              <Link to="/">Agendar outro horário</Link>
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ArrowLeft, Clock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando confirmação do Mercado Pago…",
  authorized: "Cartão autorizado — aguardando a primeira cobrança…",
  active: "Assinatura ativa!",
  paused: "Assinatura pausada.",
  cancelled: "Assinatura cancelada.",
  payment_failed: "A última cobrança falhou.",
};

export const Route = createFileRoute("/assinatura-confirmada/$subscriptionId")({
  head: () => ({ meta: [{ title: "Assinatura — VIP BARBER" }] }),
  component: ConfirmacaoAssinaturaPage,
});

function ConfirmacaoAssinaturaPage() {
  const { subscriptionId } = Route.useParams();

  const q = useQuery({
    queryKey: ["subscription-confirmation", subscriptionId],
    staleTime: 0,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_subscriptions")
        .select("id, status")
        .eq("id", subscriptionId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; status: string } | null;
    },
  });

  const status = q.data?.status;
  const isFinal = status === "active" || status === "cancelled";

  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-6">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
        <Link to="/">
          <ArrowLeft /> Início
        </Link>
      </Button>

      <div className="surface p-8 text-center">
        {q.isLoading ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : status === "active" ? (
          <CheckCircle2 className="mx-auto size-12 text-success" />
        ) : (
          <Clock className="mx-auto size-12 text-muted-foreground" />
        )}
        <h1 className="mt-4 text-lg font-semibold">
          {status ? (STATUS_LABEL[status] ?? "Processando assinatura…") : "Processando assinatura…"}
        </h1>
        {!isFinal && (
          <p className="mt-2 text-sm text-muted-foreground">
            Isso costuma levar só alguns segundos. Não feche esta página.
          </p>
        )}
      </div>

      <Button asChild variant="hero" className="mt-6 w-full">
        <Link to="/meus-agendamentos">Ver meus agendamentos</Link>
      </Button>
    </main>
  );
}

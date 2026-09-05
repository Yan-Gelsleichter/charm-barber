import { useQuery } from "@tanstack/react-query";

export type SubscriptionGateReason = "trial_expired" | "past_due" | "canceled";

export type SubscriptionStatusResponse = {
  subscription_status?: string;
  trial_ends_at?: string | null;
  current_period_ends_at?: string | null;
  subscription_plan?: string | null;
  pending_plan_change?: string | null;
  subscription_id?: string | null;
  cancel_at_period_end?: boolean;
};

function computeGateReason(data: SubscriptionStatusResponse | undefined): SubscriptionGateReason | null {
  if (!data) return null;
  const status = data.subscription_status ?? "trial";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "trial") {
    const trialEndsAt = data.trial_ends_at ? new Date(data.trial_ends_at) : null;
    if (trialEndsAt && trialEndsAt.getTime() < Date.now()) return "trial_expired";
  }
  return null;
}

/**
 * Busca o status de assinatura da barbearia. Compartilhada entre o gate do
 * painel (`useSubscriptionGate`) e a seção de assinatura do Perfil — mesma
 * queryKey, então o React Query faz um fetch só, não dois em paralelo.
 * Faz polling enquanto bloqueado, pra refletir a confirmação do webhook
 * (pagamento aprovado, etc.) sem o admin precisar dar F5.
 */
export function useSubscriptionStatusQuery(barbershopId: string | null) {
  return useQuery({
    queryKey: ["subscription-status", barbershopId],
    enabled: !!barbershopId,
    queryFn: async (): Promise<SubscriptionStatusResponse> => {
      const res = await fetch(
        `/api/public/subscription-status?barbershop_id=${encodeURIComponent(barbershopId!)}`,
        { cache: "no-store" },
      );
      return (await res.json().catch(() => ({}))) as SubscriptionStatusResponse;
    },
    refetchInterval: (query) => (computeGateReason(query.state.data) ? 4000 : false),
  });
}

/**
 * Diz se o acesso ao painel deve ser bloqueado por causa do status da
 * assinatura da barbearia. Só usado pelo painel admin/barbeiro — nunca
 * afeta o cliente final.
 */
export function useSubscriptionGate(barbershopId: string | null) {
  const q = useSubscriptionStatusQuery(barbershopId);
  const reason = computeGateReason(q.data);

  return {
    loading: !!barbershopId && q.isLoading,
    blocked: reason !== null,
    reason,
    data: q.data,
  };
}

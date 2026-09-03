import { useQuery } from "@tanstack/react-query";

export type SubscriptionGateReason = "trial_expired" | "past_due" | "canceled";

type SubscriptionStatusResponse = {
  subscription_status?: string;
  trial_ends_at?: string | null;
  current_period_ends_at?: string | null;
};

/**
 * Diz se o acesso ao painel deve ser bloqueado por causa do status da
 * assinatura da barbearia. Só usado pelo painel admin/barbeiro — nunca
 * afeta o cliente final.
 */
export function useSubscriptionGate(barbershopId: string | null) {
  const q = useQuery({
    queryKey: ["subscription-status", barbershopId],
    enabled: !!barbershopId,
    queryFn: async (): Promise<SubscriptionStatusResponse> => {
      const res = await fetch(
        `/api/public/subscription-status?barbershop_id=${encodeURIComponent(barbershopId!)}`,
        { cache: "no-store" },
      );
      return (await res.json().catch(() => ({}))) as SubscriptionStatusResponse;
    },
  });

  let reason: SubscriptionGateReason | null = null;
  if (q.data) {
    const status = q.data.subscription_status ?? "trial";
    if (status === "past_due") {
      reason = "past_due";
    } else if (status === "canceled") {
      reason = "canceled";
    } else if (status === "trial") {
      const trialEndsAt = q.data.trial_ends_at ? new Date(q.data.trial_ends_at) : null;
      if (trialEndsAt && trialEndsAt.getTime() < Date.now()) reason = "trial_expired";
    }
  }

  return {
    loading: !!barbershopId && q.isLoading,
    blocked: reason !== null,
    reason,
  };
}

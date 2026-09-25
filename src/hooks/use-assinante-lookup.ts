import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { postPublicApi } from "@/lib/api-fetch";

export interface AssinanteSub {
  subscription_id: string;
  plan_id: string;
  plan_name: string;
  /** Todos os serviços que o plano cobre. */
  service_ids: string[];
  /** Barbeiros que atendem o plano — só com eles o serviço sai de graça. */
  barber_ids: string[];
}

/**
 * Consulta as assinaturas ativas de um cliente pelo telefone (ao agendar ou
 * registrar atendimento pelo painel). Falha de rede nunca atrapalha o
 * formulário — vira "sem assinatura".
 */
export function useAssinanteLookup(phoneDigits: string) {
  return useQuery({
    queryKey: ["assinante-lookup", phoneDigits],
    enabled: phoneDigits.length >= 10,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<AssinanteSub[]> => {
      const { data } = await supabase.auth.getSession();
      try {
        const result = await postPublicApi<{ subscriptions?: AssinanteSub[] }>(
          "/api/public/subscription-lookup",
          { phone: phoneDigits },
          data.session?.access_token,
        );
        return result?.subscriptions ?? [];
      } catch {
        return [];
      }
    },
  });
}

/** Serviços que algum plano ativo do cliente cobre COM esse barbeiro. */
export function coveredServiceIds(subs: AssinanteSub[], barberId: string): Set<string> {
  const covered = new Set<string>();
  for (const s of subs) {
    if (!s.barber_ids.includes(barberId)) continue;
    for (const id of s.service_ids) covered.add(id);
  }
  return covered;
}

/**
 * Divide os serviços escolhidos entre "cobertos pelo plano" (sem custo) e
 * "fora do plano" (cobrados à parte). Usa uma única assinatura — a que cobre
 * mais dos serviços escolhidos.
 */
export function splitByPlan(subs: AssinanteSub[], barberId: string, selectedIds: string[]) {
  let best: { sub: AssinanteSub; covered: string[] } | null = null;
  for (const s of subs) {
    if (!s.barber_ids.includes(barberId)) continue;
    const covered = selectedIds.filter((id) => s.service_ids.includes(id));
    if (covered.length > 0 && (!best || covered.length > best.covered.length)) best = { sub: s, covered };
  }
  if (!best) return { subscription: null as AssinanteSub | null, covered: [] as string[], extras: selectedIds };
  const coveredSet = new Set(best.covered);
  return {
    subscription: best.sub,
    covered: best.covered,
    extras: selectedIds.filter((id) => !coveredSet.has(id)),
  };
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PayoutMode } from "@/lib/mercadopago";

/** Lê o modelo de repasse da barbearia (padrão: conta única). */
export function usePayoutMode(shopId: string | null) {
  return useQuery({
    queryKey: ["payout-mode", shopId],
    enabled: !!shopId,
    queryFn: async (): Promise<PayoutMode> => {
      const { data, error } = await supabase
        .from("barbershops" as never)
        .select("payout_mode")
        .eq("id", shopId!)
        .maybeSingle();
      if (error) return "unica"; // coluna ainda não criada
      const mode = (data as { payout_mode?: string | null } | null)?.payout_mode;
      return mode === "split" ? "split" : "unica";
    },
  });
}

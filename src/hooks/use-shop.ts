import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/typed-client";
import { getMyBarbershopId } from "@/lib/barbershop";

export type ShopConfig = {
  business_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
};

/**
 * Retorna as configurações da barbearia (nome, logo, cor primária) definidas
 * pelo admin. Usa somente o barbershop_id do contexto atual ou do usuário logado.
 */
export function useShopConfig(barbershopId?: string | null) {
  return useQuery({
    queryKey: ["shop-config", barbershopId ?? "auto"],
    queryFn: async (): Promise<ShopConfig> => {
      const shopId = barbershopId ?? (await getMyBarbershopId());
      if (!shopId) {
        return { business_name: null, logo_url: null, primary_color: null };
      }
      const { data, error } = await supabase
        .from("barbers")
        .select("business_name, logo_url, primary_color")
        .eq("is_admin", true)
        .eq("barbershop_id", shopId)
        .order("business_name", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return {
        business_name: data?.business_name ?? null,
        logo_url: data?.logo_url ?? null,
        primary_color: data?.primary_color ?? null,
      };
    },
  });
}

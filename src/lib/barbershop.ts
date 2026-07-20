import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string | null>();

/** Resolve barbershop_id via the barbers table (works for any logged-in user
 *  who can select the barber row through RLS). */
export async function getBarbershopIdByBarberId(barberId: string): Promise<string | null> {
  if (cache.has(barberId)) return cache.get(barberId) ?? null;
  const { data, error } = await supabase
    .from("barbers")
    .select("barbershop_id")
    .eq("id", barberId)
    .maybeSingle();
  if (error) throw error;
  const id = (data as { barbershop_id?: string | null } | null)?.barbershop_id ?? null;
  cache.set(barberId, id);
  return id;
}

/** Resolve barbershop_id from the logged-in user's profile, with fallback to
 *  their own barbers row. Returns null if none is found. */
export async function getMyBarbershopId(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return null;

  const prof = await supabase
    .from("profiles" as never)
    .select("barbershop_id")
    .eq("id", uid)
    .maybeSingle();
  const fromProfile = (prof.data as { barbershop_id?: string | null } | null)?.barbershop_id ?? null;
  if (fromProfile) return fromProfile;

  const barb = await supabase
    .from("barbers")
    .select("barbershop_id")
    .eq("user_id", uid)
    .order("is_admin", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (barb.data as { barbershop_id?: string | null } | null)?.barbershop_id ?? null;
}

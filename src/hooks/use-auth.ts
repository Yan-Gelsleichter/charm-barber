import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";

export function isClientAccount(session: Session | null) {
  return session?.user.user_metadata?.account_type === "client";
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

export function useMeBarber() {
  const { session, loading } = useSession();
  const clientAccount = isClientAccount(session);
  const userId = session?.user.id ?? null;
  const q = useQuery({
    queryKey: ["me-barber", userId],
    enabled: !!userId && !clientAccount,
    queryFn: async (): Promise<Barber | null> => {
      const { data, error } = await supabase
        .from("barbers")
        .select("*")
        .eq("user_id", userId!)
        .order("is_admin", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Barber | null;
    },
  });
  return {
    session,
    loadingSession: loading,
    barber: clientAccount ? null : q.data ?? null,
    loading: loading || q.isLoading,
    error: q.error,
    refetchBarber: q.refetch,
  };
}

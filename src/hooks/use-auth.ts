import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Barbeiro } from "@/integrations/supabase/db-types";

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

export function useMeBarbeiro() {
  const { session, loading } = useSession();
  const userId = session?.user.id ?? null;
  const q = useQuery({
    queryKey: ["me-barbeiro", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Barbeiro | null> => {
      const { data, error } = await supabase
        .from("barbeiros")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data as Barbeiro | null;
    },
  });
  return { session, loadingSession: loading, barbeiro: q.data ?? null, loading: loading || q.isLoading };
}

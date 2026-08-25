import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Appointment } from "@/integrations/supabase/db-types";

type DirectAppointmentsOptions = {
  barberId: string;
  from: string;
  to?: string;
  intervalMs?: number;
};

/**
 * Lista sem cache: cada resultado exibido vem de um SELECT concluído na tabela
 * appointments. A lista anterior é apagada antes de toda nova consulta.
 */
export function useDirectAppointments({
  barberId,
  from,
  to,
  intervalMs = 20_000,
}: DirectAppointmentsOptions) {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setAppointments(null);
    setError(null);
    setLoading(true);

    let query = supabase
      .from("appointments")
      .select("*")
      .eq("barber_id", barberId)
      .gte("appointment_time", from);
    if (to) query = query.lt("appointment_time", to);

    const result = await query.order("appointment_time");
    if (currentRequest !== requestId.current) return;

    if (result.error) {
      setError(new Error(result.error.message));
      setLoading(false);
      return;
    }

    setAppointments((result.data ?? []) as Appointment[]);
    setLoading(false);
  }, [barberId, from, to]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), intervalMs);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      requestId.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs, refresh]);

  return { appointments, error, loading, refresh };
}
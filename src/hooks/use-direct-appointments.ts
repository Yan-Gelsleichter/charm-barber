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
 * appointments. A lista só é apagada/mostra "carregando" na primeira consulta
 * de cada escopo (barbeiro/período) — atualizações periódicas em segundo
 * plano trocam os dados direto, sem apagar a tela antes (senão a lista pisca
 * a cada `intervalMs` mesmo quando nada mudou).
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
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setError(null);
    if (!hasLoadedOnce.current) setLoading(true);

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
    hasLoadedOnce.current = true;
  }, [barberId, from, to]);

  useEffect(() => {
    // Barbeiro/período mudou: essa nova consulta conta como "primeira vez"
    // desse escopo, então volta a mostrar o carregando (evita misturar com
    // os agendamentos do escopo anterior).
    hasLoadedOnce.current = false;
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
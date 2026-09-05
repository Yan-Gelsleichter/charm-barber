import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

const INTERVAL_MS = 3000; // Verifica a cada 3 segundos

/**
 * Reconcilia pagamentos pendentes enquanto o painel do barbeiro está aberto.
 * Garante que um PIX pago pelo banco (sem o cliente voltar ao app) apareça
 * como "pago" automaticamente.
 */
export function usePaymentSync(enabled: boolean) {
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const run = async () => {
      if (running.current || document.hidden) return;
      running.current = true;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/public/mercadopago-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: "{}",
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { updated?: number };
        if (!cancelled && (body.updated ?? 0) > 0) {
          // Só as telas que mostram payment_status de agendamentos — nunca
          // uma invalidação geral, que recarregaria o app inteiro (inclusive
          // abas sem nenhuma relação com pagamento) a cada sincronização.
          qc.invalidateQueries({ queryKey: ["agenda-painel"] });
          qc.invalidateQueries({ queryKey: ["agenda-apoio"] });
          qc.invalidateQueries({ queryKey: ["historico"] });
          qc.invalidateQueries({ queryKey: ["faturamento"] });
        }
      } catch {
        /* silencioso: é apenas uma verificação em segundo plano */
      } finally {
        running.current = false;
      }
    };

    void run();
    const id = window.setInterval(run, INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, qc]);
}

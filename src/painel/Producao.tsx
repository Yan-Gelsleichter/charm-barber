import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, Service, Appointment } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";

type Period = "week" | "month";

export function ProducaoTab({ barber }: { barber: Barber }) {
  const shopId = barber.barbershop_id ?? null;
  const isAdmin = !!barber.is_admin;
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(() => new Date());

  const { start, end, label } = useMemo(() => {
    if (period === "week") {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      const e = endOfWeek(anchor, { weekStartsOn: 1 });
      return { start: s, end: e, label: `${format(s, "dd/MM")} – ${format(e, "dd/MM")}` };
    }
    const s = startOfMonth(anchor);
    const e = endOfMonth(anchor);
    return { start: s, end: e, label: format(s, "MMMM 'de' yyyy", { locale: ptBR }) };
  }, [period, anchor]);

  function goPrev() {
    setAnchor((d) => (period === "week" ? addWeeks(d, -1) : addMonths(d, -1)));
  }
  function goNext() {
    setAnchor((d) => (period === "week" ? addWeeks(d, 1) : addMonths(d, 1)));
  }

  const barbersQ = useQuery({
    queryKey: ["shop-barbers-producao", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from("barbers").select("id, name").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const servicesQ = useQuery({
    queryKey: ["shop-services-producao", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("barbershop_id", shopId!);
      if (error) throw error;
      return data as Service[];
    },
  });

  const appointmentsQ = useQuery({
    queryKey: [
      "subscription-appointments",
      shopId,
      start.toISOString(),
      end.toISOString(),
      isAdmin,
      barber.id,
    ],
    enabled: !!shopId,
    queryFn: async () => {
      let query = supabase
        .from("appointments")
        .select("*")
        .eq("barbershop_id", shopId!)
        .not("covered_by_subscription_id", "is", null)
        .gte("appointment_time", start.toISOString())
        .lte("appointment_time", end.toISOString());
      if (!isAdmin) query = query.eq("barber_id", barber.id);
      const { data, error } = await query;
      if (error) throw error;
      return data as Appointment[];
    },
  });

  const serviceById = useMemo(() => {
    const m = new Map<string, Service>();
    (servicesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [servicesQ.data]);

  const barberNameById = useMemo(() => {
    const m = new Map<string, string>();
    (barbersQ.data ?? []).forEach((b) => m.set(b.id, b.name));
    return m;
  }, [barbersQ.data]);

  const rows = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const a of appointmentsQ.data ?? []) {
      const svc = serviceById.get(a.service_id);
      const price = svc?.price ?? 0;
      const cur = map.get(a.barber_id) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += price;
      map.set(a.barber_id, cur);
    }
    return Array.from(map.entries())
      .map(([barberId, v]) => ({ barberId, name: barberNameById.get(barberId) ?? "Barbeiro", ...v }))
      .sort((a, b) => b.total - a.total);
  }, [appointmentsQ.data, serviceById, barberNameById]);

  const loading = barbersQ.isLoading || servicesQ.isLoading || appointmentsQ.isLoading;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Produção de assinantes</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Atendimentos de clientes assinantes por barbeiro, para calcular o repasse do mês."
            : "Seus atendimentos de clientes assinantes no período."}
        </p>
      </header>

      <div className="surface flex items-center justify-between p-3">
        <div className="flex items-center gap-1">
          <Button variant={period === "week" ? "hero" : "ghost"} size="sm" onClick={() => setPeriod("week")}>
            Semana
          </Button>
          <Button variant={period === "month" ? "hero" : "ghost"} size="sm" onClick={() => setPeriod("month")}>
            Mês
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={goPrev}>
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium capitalize">{label}</span>
          <Button variant="ghost" size="icon" onClick={goNext}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      {loading && (
        <div className="surface flex items-center justify-center p-8">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Nenhum atendimento de assinante nesse período.
        </div>
      )}

      <div className="grid gap-2">
        {rows.map((r) => (
          <div key={r.barberId} className="surface flex items-center justify-between p-4">
            <div>
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                {r.count} atendimento{r.count === 1 ? "" : "s"} de assinantes
              </p>
            </div>
            <span className="brand-text font-bold">{brl(r.total)}</span>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Valor de referência calculado pelo preço atual de cada serviço — serve de base para o repasse manual, não é
          uma cobrança real.
        </p>
      )}
    </div>
  );
}

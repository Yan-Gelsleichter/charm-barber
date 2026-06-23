import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, WorkingHour } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DIAS_SEMANA } from "@/lib/format";

type Row = { ativo: boolean; inicio: string; fim: string };
const empty: Row = { ativo: false, inicio: "09:00", fim: "18:00" };

export function HorariosTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => Array(7).fill(0).map(() => ({ ...empty })));

  const q = useQuery({
    queryKey: ["working-hours-painel", barber.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("working_hours")
        .select("*")
        .eq("barber_id", barber.id);
      if (error) throw error;
      return data as WorkingHour[];
    },
  });

  useEffect(() => {
    if (!q.data) return;
    const next = Array(7).fill(0).map(() => ({ ...empty }));
    q.data.forEach((h) => {
      next[h.weekday] = {
        ativo: true,
        inicio: h.start_time.slice(0, 5),
        fim: h.end_time.slice(0, 5),
      };
    });
    setRows(next);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const del = await supabase
        .from("working_hours")
        .delete()
        .eq("barber_id", barber.id);
      if (del.error) throw del.error;
      const inserts = rows
        .map((r, dia) =>
          r.ativo
            ? {
                barber_id: barber.id,
                weekday: dia,
                start_time: r.inicio,
                end_time: r.fim,
              }
            : null,
        )
        .filter(Boolean);
      if (inserts.length) {
        const ins = await supabase.from("working_hours").insert(inserts as never);
        if (ins.error) throw ins.error;
      }
    },
    onSuccess: () => {
      toast.success("Horários atualizados");
      qc.invalidateQueries({ queryKey: ["working-hours-painel", barber.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marque os dias em que você atende e defina o intervalo de trabalho.
      </p>

      <div className="surface divide-y divide-border">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 p-3 sm:grid-cols-[120px_auto_1fr_1fr]"
          >
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={r.ativo}
                onChange={(e) => update(i, { ativo: e.target.checked })}
                className="size-4 accent-[color:var(--brand-from)]"
              />
              {DIAS_SEMANA[i]}
            </label>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {r.ativo ? "Atendendo" : "Folga"}
            </span>
            <Input
              type="time"
              value={r.inicio}
              onChange={(e) => update(i, { inicio: e.target.value })}
              disabled={!r.ativo}
              className="w-28"
            />
            <Input
              type="time"
              value={r.fim}
              onChange={(e) => update(i, { fim: e.target.value })}
              disabled={!r.ativo}
              className="w-28"
            />
          </div>
        ))}
      </div>

      <Button variant="hero" size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar horários
      </Button>
    </div>
  );
}

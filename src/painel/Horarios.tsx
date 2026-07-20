import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, WorkingHour } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DIAS_SEMANA } from "@/lib/format";

type Row = {
  ativo: boolean;
  inicio: string;
  fim: string;
  almoco: boolean;
  almocoInicio: string;
  almocoFim: string;
};
const empty: Row = {
  ativo: false,
  inicio: "09:00",
  fim: "18:00",
  almoco: false,
  almocoInicio: "12:00",
  almocoFim: "13:00",
};

export function HorariosTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => Array(7).fill(0).map(() => ({ ...empty })));

  const q = useQuery({
    queryKey: ["working-hours-painel", barber.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("working_hours")
        .select("*")
        .eq("barber_id", barber.id)
        .order("start_time");
      if (error) throw error;
      return data as WorkingHour[];
    },
  });

  useEffect(() => {
    if (!q.data) return;
    const next = Array(7).fill(0).map(() => ({ ...empty }));
    // group by weekday
    const byDay = new Map<number, WorkingHour[]>();
    q.data.forEach((h) => {
      const idx = Number(h.weekday);
      if (!byDay.has(idx)) byDay.set(idx, []);
      byDay.get(idx)!.push(h);
    });
    byDay.forEach((list, idx) => {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (list.length >= 2) {
        next[idx] = {
          ativo: true,
          inicio: list[0].start_time.slice(0, 5),
          fim: list[list.length - 1].end_time.slice(0, 5),
          almoco: true,
          almocoInicio: list[0].end_time.slice(0, 5),
          almocoFim: list[1].start_time.slice(0, 5),
        };
      } else {
        next[idx] = {
          ativo: true,
          inicio: list[0].start_time.slice(0, 5),
          fim: list[0].end_time.slice(0, 5),
          almoco: false,
          almocoInicio: "12:00",
          almocoFim: "13:00",
        };
      }
    });
    setRows(next);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      // validate
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.ativo) continue;
        if (r.inicio >= r.fim) throw new Error(`${DIAS_SEMANA[i]}: horário final deve ser após o inicial`);
        if (r.almoco) {
          if (r.almocoInicio <= r.inicio || r.almocoFim >= r.fim || r.almocoInicio >= r.almocoFim) {
            throw new Error(`${DIAS_SEMANA[i]}: intervalo de almoço inválido`);
          }
        }
      }

      const del = await supabase
        .from("working_hours")
        .delete()
        .eq("barber_id", barber.id);
      if (del.error) throw del.error;

      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = barber.barbershop_id ?? (await getBarbershopIdByBarberId(barber.id));

      const inserts: Array<{ barber_id: string; weekday: number; start_time: string; end_time: string; barbershop_id: string | null }> = [];
      rows.forEach((r, dia) => {
        if (!r.ativo) return;
        if (r.almoco) {
          inserts.push({ barber_id: barber.id, weekday: dia, start_time: r.inicio, end_time: r.almocoInicio, barbershop_id: barbershopId });
          inserts.push({ barber_id: barber.id, weekday: dia, start_time: r.almocoFim, end_time: r.fim, barbershop_id: barbershopId });
        } else {
          inserts.push({ barber_id: barber.id, weekday: dia, start_time: r.inicio, end_time: r.fim, barbershop_id: barbershopId });
        }
      });
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
        Marque os dias em que você atende, defina o intervalo de trabalho e, se quiser, um intervalo de almoço.
      </p>

      <div className="surface divide-y divide-border">
        {rows.map((r, i) => (
          <div key={i} className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-[110px] items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={r.ativo}
                  onChange={(e) => update(i, { ativo: e.target.checked })}
                  className="size-4 accent-[color:var(--brand-from)]"
                />
                {DIAS_SEMANA[i]}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={r.inicio}
                  onChange={(e) => update(i, { inicio: e.target.value })}
                  disabled={!r.ativo}
                  className="w-28"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <Input
                  type="time"
                  value={r.fim}
                  onChange={(e) => update(i, { fim: e.target.value })}
                  disabled={!r.ativo}
                  className="w-28"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pl-1">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={r.almoco}
                  onChange={(e) => update(i, { almoco: e.target.checked })}
                  disabled={!r.ativo}
                  className="size-3.5 accent-[color:var(--brand-from)]"
                />
                Intervalo de almoço
              </label>
              {r.almoco && r.ativo && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={r.almocoInicio}
                    onChange={(e) => update(i, { almocoInicio: e.target.value })}
                    className="w-28"
                  />
                  <span className="text-xs text-muted-foreground">até</span>
                  <Input
                    type="time"
                    value={r.almocoFim}
                    onChange={(e) => update(i, { almocoFim: e.target.value })}
                    className="w-28"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button variant="hero" size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar horários
      </Button>
    </div>
  );
}

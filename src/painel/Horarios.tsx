import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barbeiro, HorarioTrabalho } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DIAS_SEMANA } from "@/lib/format";

type Row = { ativo: boolean; inicio: string; fim: string };

const empty: Row = { ativo: false, inicio: "09:00", fim: "18:00" };

export function HorariosTab({ barbeiro }: { barbeiro: Barbeiro }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => Array(7).fill(0).map(() => ({ ...empty })));

  const q = useQuery({
    queryKey: ["horarios-painel", barbeiro.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("horarios_trabalho")
        .select("*")
        .eq("barbeiro_id", barbeiro.id);
      if (error) throw error;
      return data as HorarioTrabalho[];
    },
  });

  useEffect(() => {
    if (!q.data) return;
    const next = Array(7).fill(0).map(() => ({ ...empty }));
    q.data.forEach((h) => {
      next[h.dia_semana] = {
        ativo: true,
        inicio: h.hora_inicio.slice(0, 5),
        fim: h.hora_fim.slice(0, 5),
      };
    });
    setRows(next);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      // wipe + reinsert (RLS scoped to barbeiro)
      const del = await supabase
        .from("horarios_trabalho")
        .delete()
        .eq("barbeiro_id", barbeiro.id);
      if (del.error) throw del.error;
      const inserts = rows
        .map((r, dia) =>
          r.ativo
            ? {
                barbeiro_id: barbeiro.id,
                dia_semana: dia,
                hora_inicio: r.inicio,
                hora_fim: r.fim,
              }
            : null,
        )
        .filter(Boolean);
      if (inserts.length) {
        const ins = await supabase.from("horarios_trabalho").insert(inserts as never);
        if (ins.error) throw ins.error;
      }
    },
    onSuccess: () => {
      toast.success("Horários atualizados");
      qc.invalidateQueries({ queryKey: ["horarios-painel", barbeiro.id] });
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

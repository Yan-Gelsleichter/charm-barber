import type { Agendamento, HorarioTrabalho, Servico } from "@/integrations/supabase/types";

export type Slot = { start: Date; end: Date; available: boolean };

const SLOT_STEP_MIN = 15;

function parseTime(hms: string, base: Date): Date {
  const [h, m] = hms.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  return d;
}

/**
 * Gera slots de SLOT_STEP_MIN minutos dentro do expediente do barbeiro
 * naquele dia. Marca como indisponível qualquer slot cujo intervalo
 * [start, start+duracao) sobreponha um agendamento existente
 * (considerando duração do serviço de cada agendamento conhecido,
 * ou um buffer mínimo do próprio serviço sendo agendado).
 */
export function buildSlots(params: {
  date: Date;
  horarios: HorarioTrabalho[];
  servico: Servico;
  agendamentos: Array<Pick<Agendamento, "horario_consulta" | "servico_id" | "status">>;
  servicosMap: Map<string, Servico>;
}): Slot[] {
  const { date, horarios, servico, agendamentos, servicosMap } = params;
  const dow = date.getDay();
  const work = horarios.find((h) => h.dia_semana === dow);
  if (!work) return [];

  const start = parseTime(work.hora_inicio, date);
  const end = parseTime(work.hora_fim, date);
  const dur = servico.duracao_minutos;

  const busy: Array<[number, number]> = agendamentos
    .filter((a) => a.status !== "cancelado")
    .map((a) => {
      const s = new Date(a.horario_consulta).getTime();
      const sv = servicosMap.get(a.servico_id);
      const d = sv?.duracao_minutos ?? dur;
      return [s, s + d * 60_000] as [number, number];
    });

  const slots: Slot[] = [];
  const now = Date.now();
  for (
    let t = start.getTime();
    t + dur * 60_000 <= end.getTime();
    t += SLOT_STEP_MIN * 60_000
  ) {
    const slotEnd = t + dur * 60_000;
    const past = t < now;
    const overlap = busy.some(([bs, be]) => t < be && slotEnd > bs);
    slots.push({
      start: new Date(t),
      end: new Date(slotEnd),
      available: !overlap && !past,
    });
  }
  return slots;
}

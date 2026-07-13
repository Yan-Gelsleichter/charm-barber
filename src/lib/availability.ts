import type { Appointment, WorkingHour, Service } from "@/integrations/supabase/db-types";

export type Slot = { start: Date; end: Date; available: boolean };

const SLOT_STEP_MIN = 15;
const INACTIVE_STATUSES = new Set(["cancelado", "cancelada", "cancelled", "remarcado", "remarcando"]);

function isBusyStatus(status: string | null | undefined): boolean {
  const normalized = (status || "confirmado").trim().toLowerCase();
  return !INACTIVE_STATUSES.has(normalized);
}

function parseTime(hms: string, base: Date): Date {
  const [h, m] = hms.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  return d;
}

export function buildSlots(params: {
  date: Date;
  hours: WorkingHour[];
  service: Service;
  appointments: Array<Pick<Appointment, "appointment_time" | "service_id" | "status">>;
  servicesMap: Map<string, Service>;
}): Slot[] {
  const { date, hours, service, appointments, servicesMap } = params;
  const dow = date.getDay();
  const work = hours.find((h) => Number(h.weekday) === dow);
  if (!work) return [];

  const start = parseTime(work.start_time, date);
  const end = parseTime(work.end_time, date);
  const dur = service.duration_minutes;

  const busy: Array<[number, number]> = appointments
    .filter((a) => isBusyStatus(a.status))
    .map((a) => {
      const s = new Date(a.appointment_time).getTime();
      const sv = servicesMap.get(a.service_id);
      const d = sv?.duration_minutes ?? dur;
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

import type { Appointment, WorkingHour, Service } from "@/integrations/supabase/db-types";

export type Slot = { start: Date; end: Date; available: boolean };

const SLOT_STEP_MIN = 15;
const INACTIVE_STATUSES = new Set(["cancelado", "cancelada", "cancelled", "remarcado", "remarcando"]);
const CANCELLATION_MARKER_PREFIX = "CANCELADO:";

export function isInactiveStatus(status: string | null | undefined): boolean {
  const normalized = (status || "confirmado").trim().toLowerCase();
  return INACTIVE_STATUSES.has(normalized) || normalized.startsWith("cancelado:");
}

export function cancellationMarkerName(appointmentId: string, customerName: string): string {
  return `${CANCELLATION_MARKER_PREFIX}${appointmentId}:${customerName}`;
}

export function cancellationMarkerTime(appointmentTime: string): string {
  const original = new Date(appointmentTime);
  const marker = new Date(original.getTime() + 1000);
  return marker.toISOString();
}

type AppointmentState = Pick<Appointment, "id" | "status"> & Partial<Pick<Appointment, "customer_name">>;

export function cancellationTargetId(appointment: AppointmentState): string | null {
  const status = (appointment.status || "").trim().toLowerCase();
  if (status.startsWith("cancelado:")) return appointment.status.trim().slice("cancelado:".length);

  const name = appointment.customer_name?.trim() ?? "";
  if (isInactiveStatus(appointment.status) && name.startsWith(CANCELLATION_MARKER_PREFIX)) {
    return name.slice(CANCELLATION_MARKER_PREFIX.length).split(":")[0] || null;
  }

  return null;
}

export function cancelledAppointmentIds(appointments: AppointmentState[]): Set<string> {
  return new Set(appointments.map(cancellationTargetId).filter((id): id is string => !!id));
}

export function isAppointmentActive(
  appointment: AppointmentState,
  cancelledIds = new Set<string>(),
): boolean {
  return !isInactiveStatus(appointment.status) && !cancelledIds.has(appointment.id);
}

export function filterActiveAppointments<T extends AppointmentState>(appointments: T[]): T[] {
  const cancelledIds = cancelledAppointmentIds(appointments);
  return appointments.filter((appointment) => isAppointmentActive(appointment, cancelledIds));
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
  appointments: Array<Pick<Appointment, "id" | "appointment_time" | "service_id" | "status"> & Partial<Pick<Appointment, "customer_name">>>;
  servicesMap: Map<string, Service>;
}): Slot[] {
  const { date, hours, service, appointments, servicesMap } = params;
  const dow = date.getDay();
  const works = hours.filter((h) => Number(h.weekday) === dow);
  if (works.length === 0) return [];

  const dur = service.duration_minutes;

  const inactiveIds = cancelledAppointmentIds(appointments);
  const busy: Array<[number, number]> = appointments
    .filter((a) => isAppointmentActive(a, inactiveIds))
    .map((a) => {
      const s = new Date(a.appointment_time).getTime();
      const sv = servicesMap.get(a.service_id);
      const d = sv?.duration_minutes ?? dur;
      return [s, s + d * 60_000] as [number, number];
    });

  const slots: Slot[] = [];
  const now = Date.now();
  for (const work of works) {
    const start = parseTime(work.start_time, date);
    const end = parseTime(work.end_time, date);
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
  }
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

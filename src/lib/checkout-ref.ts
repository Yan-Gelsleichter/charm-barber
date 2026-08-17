/**
 * Guarda localmente a preferência criada no Checkout Pro para cada agendamento.
 * Ao voltar do Mercado Pago conseguimos consultar o pagamento mesmo quando o
 * navegador não devolve payment_id na URL.
 */
const key = (appointmentId: string) => `mp_pref:${appointmentId}`;

export function saveCheckoutRef(appointmentId: string, preferenceId?: string | null) {
  if (typeof window === "undefined" || !preferenceId) return;
  try {
    localStorage.setItem(key(appointmentId), preferenceId);
  } catch {
    /* ignore */
  }
}

export function readCheckoutRef(appointmentId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key(appointmentId));
  } catch {
    return null;
  }
}

export function clearCheckoutRef(appointmentId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key(appointmentId));
  } catch {
    /* ignore */
  }
}

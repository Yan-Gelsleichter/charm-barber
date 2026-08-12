/**
 * Telemetria de auditoria dos pagamentos do Mercado Pago.
 *
 * Toda criação de pagamento (PIX ou cartão, inclusive retentativas) registra
 * uma linha estruturada com o e-mail do pagador mascarado, o external_reference
 * da tentativa e, na resposta, o payment_id + status_detail. Isso permite
 * rastrear recusas como `cc_rejected_high_risk` até a tentativa exata.
 */

/** Mascara o e-mail preservando o suficiente para auditoria (ex.: ya***r@gmail.com). */
export function maskEmail(email: string | null | undefined): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  if (!value.includes("@")) return value ? "[invalido]" : null;
  const [local, domain] = value.split("@");
  const visible =
    local.length <= 2 ? `${local.slice(0, 1)}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${visible}@${domain}`;
}

type AttemptInfo = {
  method: "pix" | "credit_card";
  appointmentId: string;
  barberId?: string | null;
  payerEmail: string | null;
  externalReference: string;
  idempotencyKey: string;
  amount: number;
  installments?: number | null;
  deviceId?: string | null;
  savedCard?: boolean;
};

export function logPaymentAttempt(info: AttemptInfo) {
  console.info("[mp-audit] pagamento: tentativa", {
    event: "mp_payment_attempt",
    at: new Date().toISOString(),
    method: info.method,
    appointment_id: info.appointmentId,
    barber_id: info.barberId ?? null,
    payer_email: maskEmail(info.payerEmail),
    payer_email_present: Boolean(info.payerEmail),
    external_reference: info.externalReference,
    idempotency_key: info.idempotencyKey,
    amount: info.amount,
    installments: info.installments ?? null,
    device_session_present: Boolean(info.deviceId),
    saved_card: info.savedCard ?? undefined,
  });
}

type ResultInfo = AttemptInfo & {
  httpStatus: number;
  paymentId?: string | number | null;
  status?: string | null;
  statusDetail?: string | null;
  message?: string | null;
};

export function logPaymentResult(info: ResultInfo) {
  const ok = info.httpStatus < 400 && Boolean(info.paymentId);
  const rejected = info.status === "rejected" || !ok;
  const entry = {
    event: "mp_payment_result",
    at: new Date().toISOString(),
    method: info.method,
    appointment_id: info.appointmentId,
    barber_id: info.barberId ?? null,
    payer_email: maskEmail(info.payerEmail),
    external_reference: info.externalReference,
    idempotency_key: info.idempotencyKey,
    amount: info.amount,
    http_status: info.httpStatus,
    payment_id: info.paymentId ?? null,
    status: info.status ?? null,
    status_detail: info.statusDetail ?? null,
    message: info.message ?? null,
    device_session_present: Boolean(info.deviceId),
  };
  if (rejected) console.error("[mp-audit] pagamento: recusado", entry);
  else console.info("[mp-audit] pagamento: aprovado/pendente", entry);
}

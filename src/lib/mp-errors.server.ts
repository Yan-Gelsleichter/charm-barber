/** Mensagens amigáveis para recusas/erros do Mercado Pago. */
const DETAIL_MESSAGES: Record<string, string> = {
  cc_rejected_high_risk:
    "Pagamento recusado por segurança do Mercado Pago. Tente outro meio de pagamento.",
  cc_rejected_insufficient_amount: "Saldo/limite insuficiente para concluir o pagamento.",
  cc_rejected_bad_filled_card_number: "Número do cartão inválido.",
  cc_rejected_bad_filled_date: "Data de validade inválida.",
  cc_rejected_bad_filled_security_code: "Código de segurança inválido.",
  cc_rejected_bad_filled_other: "Dados do cartão inválidos. Confira e tente novamente.",
  cc_rejected_call_for_authorize: "Autorize o pagamento com o seu banco e tente novamente.",
  cc_rejected_card_disabled: "Cartão desabilitado. Fale com o seu banco.",
  cc_rejected_duplicated_payment: "Pagamento duplicado. Verifique se a cobrança já foi feita.",
  cc_rejected_max_attempts: "Muitas tentativas. Tente novamente mais tarde ou use outro cartão.",
  cc_rejected_other_reason: "Pagamento recusado pelo banco emissor.",
};

export function paymentErrorMessage(
  statusDetail?: string | null,
  status?: string | null,
  fallback?: string | null,
): string {
  const detail = (statusDetail ?? "").trim();
  if (detail && DETAIL_MESSAGES[detail]) return DETAIL_MESSAGES[detail]!;
  if (status === "rejected") return "Pagamento recusado. Tente outro meio de pagamento.";
  if (fallback) return fallback;
  return "Não foi possível processar o pagamento. Tente novamente.";
}

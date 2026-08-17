/** Traduz o status do Mercado Pago para o status usado no app. */
export function mapPaymentStatus(mpStatus?: string | null): string {
  switch ((mpStatus ?? "").toLowerCase()) {
    case "approved":
    case "authorized":
      return "pago";
    case "cancelled":
      return "cancelado";
    case "expired":
      return "expirado";
    case "rejected":
      return "falhou";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return "pendente";
  }
}

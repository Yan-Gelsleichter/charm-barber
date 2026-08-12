/**
 * O Mercado Pago exige `payer.email` em todo pagamento criado por API
 * (PIX, cartão novo, cartão salvo e qualquer reprocessamento/retentativa).
 * Centralizamos aqui a resolução e a validação para que nenhuma rota envie
 * a cobrança sem esse dado.
 */

export const PAYER_EMAIL_ERROR =
  "Não encontramos um e-mail válido no seu cadastro. Atualize seu e-mail no perfil e tente novamente.";

export function isValidEmail(value: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

/** Primeiro e-mail válido entre a sessão, o agendamento e o cadastro. */
export function resolvePayerEmail(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const email = String(candidate ?? "").trim().toLowerCase();
    if (isValidEmail(email)) return email;
  }
  return null;
}

/**
 * Normalização dos dados do pagador antes de enviar ao Mercado Pago.
 * O antifraude recusa payloads com espaços sobrando ou caracteres inválidos,
 * então tudo passa por aqui antes de virar `payer`/`additional_info`.
 */

/** Só dígitos. */
export function onlyDigits(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Texto limpo: sem caracteres de controle, sem espaços duplicados, aparado. */
export function cleanText(value: string, max = 80): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Número do endereço: dígitos/letras, sem espaços. */
export function cleanStreetNumber(value: string): string {
  const cleaned = String(value ?? "")
    .replace(/[^\p{L}\p{N}/\-]/gu, "")
    .toUpperCase()
    .slice(0, 10);
  return cleaned || "S/N";
}

/**
 * Sanitização do device fingerprint do Mercado Pago.
 *
 * A API rejeita a requisição ("Dados inválidos") quando o device_id vem com
 * caracteres fora do padrão ou acima de 200 caracteres. Aqui normalizamos:
 * removemos espaços, aceitamos apenas caracteres seguros e truncamos em 200.
 * Se o valor não puder ser aproveitado, devolvemos null e o pagamento segue
 * sem o header (melhor que ser recusado por validação de campo).
 */
const MAX_LENGTH = 200;
const ALLOWED = /^[A-Za-z0-9._:-]+$/;

export function sanitizeMpDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const truncated = trimmed.slice(0, MAX_LENGTH);
  if (truncated.length < 4) return null;
  if (!ALLOWED.test(truncated)) return null;
  return truncated;
}

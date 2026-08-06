/**
 * URL pública de produção do aplicativo.
 * Usada para gerar links compartilháveis (QR Code, convites) que não devem
 * apontar para domínios internos de preview/desenvolvimento do Lovable.
 */
export const PUBLIC_APP_URL = "https://charm-barber.lovable.app";

const INTERNAL_HOST_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "id-preview--",
  "-dev.lovable.app",
  "lovableproject.com",
  "lovable.dev",
  "sandbox",
];

/** Origem pública a usar em links compartilháveis. */
export function publicAppOrigin(): string {
  if (typeof window === "undefined") return PUBLIC_APP_URL;
  const host = window.location.hostname;
  const isInternal = INTERNAL_HOST_PATTERNS.some((p) => host.includes(p));
  return isInternal ? PUBLIC_APP_URL : window.location.origin;
}

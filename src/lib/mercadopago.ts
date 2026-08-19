import { publicAppOrigin } from "@/lib/app-url";

export const MP_CLIENT_ID_KEY = "mp_client_id";

export type PayoutMode = "unica" | "split";

export function envClientId() {
  return (import.meta.env.VITE_MP_CLIENT_ID as string | undefined)?.trim() || "";
}

export function storedClientId() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(MP_CLIENT_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveClientId(id: string) {
  try {
    localStorage.setItem(MP_CLIENT_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Redirect URI do OAuth. SEMPRE usa o domínio público de produção — o
 * Mercado Pago exige que a URL seja idêntica à cadastrada na aplicação;
 * domínios de preview/localhost fazem o MP recusar com "aplicação não está
 * pronta para conexão".
 */
export function mpRedirectUri() {
  return `${publicAppOrigin()}/api/public/mercadopago-oauth`;
}

/** state = barbershop_id (conta única) ou "barber:<barber_id>" (split por subcontas) */
export function mpAuthUrl(clientId: string, state: string) {
  return (
    `https://auth.mercadopago.com/authorization?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(mpRedirectUri())}`
  );
}

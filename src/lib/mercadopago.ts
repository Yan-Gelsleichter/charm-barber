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
    `&response_type=code&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(mpRedirectUri())}`
  );
}

function base64url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * URL de autorização com PKCE. O Mercado Pago passou a exigir
 * code_challenge/code_challenge_method nas novas conexões OAuth — sem isso a
 * tela responde "esta aplicação não está pronta para conexão".
 * O code_verifier viaja no state para que o callback (servidor) possa
 * completar a troca do code sem depender do navegador.
 */
export async function mpAuthUrlPkce(clientId: string, state: string) {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const verifier = base64url(raw);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  const fullState = `${state}|pkce:${verifier}`;
  return (
    `https://auth.mercadopago.com/authorization?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&state=${encodeURIComponent(fullState)}` +
    `&redirect_uri=${encodeURIComponent(mpRedirectUri())}` +
    `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`
  );
}


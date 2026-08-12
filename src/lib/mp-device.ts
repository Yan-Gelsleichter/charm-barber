/**
 * Device fingerprint do Mercado Pago.
 *
 * O antifraude do Mercado Pago exige o identificador do dispositivo em
 * pagamentos feitos por API. Sem ele, uma parte grande das transações é
 * recusada com `cc_rejected_high_risk`, mesmo com cartões válidos.
 *
 * O script oficial (security.js) preenche `window.MP_DEVICE_SESSION_ID`;
 * esse valor deve ser enviado ao backend e repassado ao Mercado Pago no
 * header `X-meli-session-id`.
 */
const SCRIPT_ID = "mp-security-js";
const SCRIPT_SRC = "https://www.mercadopago.com/v2/security.js";

declare global {
  interface Window {
    MP_DEVICE_SESSION_ID?: string;
  }
}

/** Injeta o security.js uma única vez (no-op fora do navegador). */
export function loadMpSecurityScript() {
  if (typeof document === "undefined") return;
  if (document.getElementById(SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = SCRIPT_SRC;
  script.setAttribute("view", "checkout");
  script.setAttribute("output", "MP_DEVICE_SESSION_ID");
  script.async = true;
  document.head.appendChild(script);
}

/**
 * Devolve o device id, aguardando o script terminar de carregar.
 * Nunca lança: se não estiver disponível, devolve null e o pagamento segue.
 */
export async function getMpDeviceId(timeoutMs = 4000): Promise<string | null> {
  if (typeof window === "undefined") return null;
  loadMpSecurityScript();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = window.MP_DEVICE_SESSION_ID;
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return window.MP_DEVICE_SESSION_ID ?? null;
}

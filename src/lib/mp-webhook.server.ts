/**
 * URL de notificação (webhook) do Mercado Pago.
 *
 * O Mercado Pago só envia os eventos `payment.created` / `payment.updated`
 * quando o pagamento é criado com `notification_url`. Sem isso, o status
 * do agendamento nunca é atualizado automaticamente.
 *
 * A URL precisa ser pública e HTTPS — domínios internos de preview
 * (localhost, *-dev.lovable.app, sandbox) são recusados pelo Mercado Pago,
 * então nesses casos usamos o domínio público de produção.
 */
import { PUBLIC_APP_URL } from "./app-url";

const WEBHOOK_PATH = "/api/public/mercadopago-webhook";

const INTERNAL_HOST_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "id-preview--",
  "-dev.lovable.app",
  "lovableproject.com",
  "lovable.dev",
  "sandbox",
];

function isPublicHttps(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    return !INTERNAL_HOST_PATTERNS.some((p) => url.hostname.includes(p));
  } catch {
    return false;
  }
}

/**
 * Monta a notification_url a partir de (nesta ordem):
 *   1. MP_NOTIFICATION_URL (configuração explícita)
 *   2. APP_URL
 *   3. origem da requisição atual, se for pública e HTTPS
 *   4. domínio público do app
 */
export function mpNotificationUrl(requestUrl?: string): string {
  const explicit = (process.env["MP_NOTIFICATION_URL"] ?? "").trim();
  if (explicit) return explicit;

  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/+$/, "");
  if (appUrl && isPublicHttps(appUrl)) return `${appUrl}${WEBHOOK_PATH}`;

  if (requestUrl) {
    try {
      const origin = new URL(requestUrl).origin;
      if (isPublicHttps(origin)) return `${origin}${WEBHOOK_PATH}`;
    } catch {
      /* ignora URL inválida */
    }
  }

  return `${PUBLIC_APP_URL}${WEBHOOK_PATH}`;
}

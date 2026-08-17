/**
 * Registro automático do Webhook no Mercado Pago logo após o OAuth.
 *
 * Objetivo: o barbeiro/dono só clica em "Conectar ao Mercado Pago"; o app
 * cria a notificação (webhook) na conta conectada, captura a "Assinatura
 * secreta" devolvida pela API e grava em `mp_webhook_secret`.
 *
 * A API de webhooks do Mercado Pago tem variações por versão de conta, então
 * tentamos os endpoints conhecidos em ordem e aceitamos o primeiro que
 * responder OK. Falhas nunca quebram o fluxo de conexão.
 */

export const WEBHOOK_EVENTS = ["payment", "merchant_order"] as const;

export function webhookUrlFor(appUrl: string) {
  const base = (appUrl || "https://charm-barber.lovable.app").replace(/\/+$/, "");
  return `${base}/api/public/webhooks/mercadopago`;
}

type AnyJson = Record<string, unknown>;

function pickSecret(json: AnyJson | null): string | null {
  if (!json) return null;
  const candidates = [
    json["secret"],
    json["secret_key"],
    json["signature_secret"],
    (json["webhook"] as AnyJson | undefined)?.["secret"],
    (json["config"] as AnyJson | undefined)?.["secret"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

async function callMp(
  url: string,
  method: "POST" | "PUT" | "GET",
  accessToken: string,
  body?: unknown,
): Promise<{ ok: boolean; json: AnyJson | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => null)) as AnyJson | null;
    return { ok: res.ok, json };
  } catch {
    return { ok: false, json: null };
  }
}

/**
 * Cria/atualiza o webhook na conta conectada e devolve a secret, quando a API
 * a fornecer. Retorna `null` se não foi possível obter a assinatura secreta.
 */
export async function registerMpWebhook(opts: {
  accessToken: string;
  appUrl: string;
  applicationId?: string | null;
}): Promise<{ secret: string | null; url: string; registered: boolean }> {
  const url = webhookUrlFor(opts.appUrl);
  const payload = { url, events: [...WEBHOOK_EVENTS] };

  const attempts: Array<{ endpoint: string; method: "POST" | "PUT"; body: unknown }> = [
    { endpoint: "https://api.mercadopago.com/v1/webhooks", method: "POST", body: payload },
  ];
  if (opts.applicationId) {
    attempts.push({
      endpoint: `https://api.mercadopago.com/applications/${opts.applicationId}/webhooks`,
      method: "PUT",
      body: payload,
    });
  }

  let registered = false;
  for (const attempt of attempts) {
    const { ok, json } = await callMp(attempt.endpoint, attempt.method, opts.accessToken, attempt.body);
    if (!ok) continue;
    registered = true;
    const secret = pickSecret(json);
    if (secret) return { secret, url, registered: true };
  }

  // Alguns endpoints só devolvem a secret ao consultar depois da criação.
  const { ok, json } = await callMp(
    "https://api.mercadopago.com/v1/webhooks",
    "GET",
    opts.accessToken,
  );
  if (ok) {
    const list = Array.isArray(json)
      ? (json as unknown as AnyJson[])
      : Array.isArray(json?.["results"])
        ? (json!["results"] as AnyJson[])
        : [];
    const match = list.find((w) => String(w["url"] ?? "") === url) ?? list[0];
    const secret = pickSecret(match ?? null);
    if (secret) return { secret, url, registered: true };
  }

  return { secret: null, url, registered };
}

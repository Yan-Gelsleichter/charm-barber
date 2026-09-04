/**
 * Assinatura da BARBEARIA com a própria plataforma (SaaS) — diferente e sem
 * relação com `client_subscriptions` (assinatura de um cliente final com um
 * plano da barbearia). Aqui o dinheiro flui barbearia → plataforma, então
 * SEMPRE usa `mpPlatformCredentials()`, nunca token de barbearia/barbeiro.
 */
import { mpPlatformCredentials } from "@/lib/mp-platform.server";
import { mpNotificationUrl } from "@/lib/mp-webhook.server";
import { publicOrigin } from "@/lib/app-origin.server";

export type PlatformPlan = "monthly" | "yearly";

export const PLATFORM_PLAN_PRICES: Record<PlatformPlan, number> = {
  monthly: 49,
  yearly: 39,
};

const EXTERNAL_REF_PREFIX = "platform-sub:";

export function platformExternalRef(barbershopId: string): string {
  return `${EXTERNAL_REF_PREFIX}${barbershopId}`;
}

export function parsePlatformExternalRef(ref: string): string | null {
  return ref.startsWith(EXTERNAL_REF_PREFIX) ? ref.slice(EXTERNAL_REF_PREFIX.length) : null;
}

type CreateResult =
  | { ok: true; preapprovalId: string; initPoint: string }
  | { ok: false; error: string };

/** Sempre a conta da plataforma. Cria uma nova preapproval mensal (o plano anual também cobra por mês, só o valor muda). */
export async function createPlatformPreapproval(params: {
  barbershopId: string;
  plan: PlatformPlan;
  payerEmail: string;
  requestUrl: string;
}): Promise<CreateResult> {
  const platform = mpPlatformCredentials();
  if (!platform?.accessToken) {
    return { ok: false, error: "A assinatura da plataforma ainda não está configurada." };
  }

  const origin = publicOrigin(params.requestUrl);
  const body = {
    reason: params.plan === "yearly" ? "Barber Connect — Plano Anual" : "Barber Connect — Plano Mensal",
    external_reference: platformExternalRef(params.barbershopId),
    payer_email: params.payerEmail,
    back_url: `${origin}/painel`,
    notification_url: mpNotificationUrl(params.requestUrl),
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: PLATFORM_PLAN_PRICES[params.plan],
      currency_id: "BRL",
    },
  };

  const res = await fetch("https://api.mercadopago.com/preapproval", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${platform.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const rawBody = await res.text().catch(() => "");
  let parsed: { id?: string; init_point?: string; message?: string; error?: string } = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = {};
  }

  if (res.ok && parsed.id && parsed.init_point) {
    return { ok: true, preapprovalId: String(parsed.id), initPoint: parsed.init_point };
  }

  console.error("Assinatura da plataforma: preapproval recusada", {
    status: res.status,
    body: rawBody.slice(0, 1000),
  });
  return {
    ok: false,
    error: parsed.message || parsed.error || "Não foi possível iniciar a assinatura.",
  };
}

/** Best-effort: nunca lança, só diz se conseguiu cancelar. */
export async function cancelPlatformPreapproval(preapprovalId: string): Promise<boolean> {
  const platform = mpPlatformCredentials();
  if (!platform?.accessToken) return false;
  try {
    const res = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${platform.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "cancelled" }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Assinatura da plataforma: falha ao cancelar preapproval", {
        preapprovalId,
        status: res.status,
        body: text.slice(0, 500),
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Assinatura da plataforma: erro inesperado ao cancelar preapproval", error);
    return false;
  }
}

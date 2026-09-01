import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

function getAdminMessaging() {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;

  try {
    const serviceAccount = JSON.parse(raw);
    const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
    return getMessaging(app);
  } catch (error) {
    console.error("[push] FIREBASE_SERVICE_ACCOUNT_JSON inválido", error);
    return null;
  }
}

/**
 * Manda uma notificação push pra um ou mais tokens. Nunca lança erro — quem
 * chama trata isso como melhor esforço (um agendamento/lembrete não deve
 * falhar por causa de um push que não foi entregue). Tokens inválidos/
 * expirados são devolvidos pra quem chamar poder limpá-los do banco.
 */
export async function sendPush(
  tokens: string[],
  notification: { title: string; body: string; url?: string },
): Promise<{ invalidTokens: string[] }> {
  const messaging = getAdminMessaging();
  const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));
  if (!messaging || uniqueTokens.length === 0) return { invalidTokens: [] };

  const invalidTokens: string[] = [];
  try {
    // Só "data" (sem "notification"): quando a mensagem tem os dois, o
    // navegador mostra o aviso sozinho por conta própria E o service worker
    // (onBackgroundMessage) mostra de novo — resultado é notificação
    // duplicada. Com "data" puro, só o nosso código decide, uma vez só.
    const result = await messaging.sendEachForMulticast({
      tokens: uniqueTokens,
      data: {
        title: notification.title,
        body: notification.body,
        ...(notification.url ? { url: notification.url } : {}),
      },
    });
    result.responses.forEach((res, i) => {
      if (!res.success && isInvalidTokenError(res.error?.code)) {
        invalidTokens.push(uniqueTokens[i]);
      }
    });
  } catch (error) {
    console.error("[push] falha ao enviar", error);
  }
  return { invalidTokens };
}

function isInvalidTokenError(code?: string): boolean {
  return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument";
}

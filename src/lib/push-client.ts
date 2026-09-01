import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

function isConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && VAPID_KEY);
}

function getFirebaseApp() {
  return getApps()[0] ?? initializeApp(firebaseConfig);
}

/**
 * Pede permissão de notificação, registra o service worker do Firebase
 * (passando a config pública pela própria URL, já que um arquivo estático
 * em public/ não tem acesso às variáveis de ambiente do build) e devolve o
 * token deste aparelho/navegador — ou null se não deu (permissão negada,
 * navegador sem suporte, ou Firebase não configurado).
 */
export async function requestPushToken(): Promise<string | null> {
  if (typeof window === "undefined" || !isConfigured()) return null;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const swParams = new URLSearchParams({
      apiKey: firebaseConfig.apiKey ?? "",
      authDomain: firebaseConfig.authDomain ?? "",
      projectId: firebaseConfig.projectId ?? "",
      storageBucket: firebaseConfig.storageBucket ?? "",
      messagingSenderId: firebaseConfig.messagingSenderId ?? "",
      appId: firebaseConfig.appId ?? "",
    });
    const registration = await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${swParams.toString()}`,
    );

    const messaging = getMessaging(getFirebaseApp());
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (error) {
    console.error("[push] falha ao pedir permissão/token", error);
    return null;
  }
}

/** Mostra um toast quando o push chega com o app já aberto em primeiro plano. */
export function listenForegroundPush(onPush: (title: string, body: string) => void): () => void {
  if (typeof window === "undefined" || !isConfigured()) return () => {};
  try {
    const messaging = getMessaging(getFirebaseApp());
    return onMessage(messaging, (payload) => {
      onPush(payload.notification?.title ?? "VIP BARBER", payload.notification?.body ?? "");
    });
  } catch {
    return () => {};
  }
}

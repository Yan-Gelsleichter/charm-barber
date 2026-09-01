// Service worker do Firebase Cloud Messaging — mostra a notificação quando
// o app NÃO está aberto/em primeiro plano. Fica em public/ porque precisa
// ser servido na raiz do site (regra do navegador para service workers).
//
// A configuração do Firebase não é secreta (são identificadores públicos do
// projeto), mas como esse é um arquivo estático (sem acesso a variáveis de
// ambiente do build), ela chega aqui pela própria URL de registro — veja
// src/lib/push-client.ts.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const params = new URLSearchParams(self.location.search);

firebase.initializeApp({
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? "VIP BARBER";
  const options = {
    body: payload.notification?.body ?? "",
    data: payload.data ?? {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.openWindow(url));
});

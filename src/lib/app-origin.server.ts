import { PUBLIC_APP_URL } from "@/lib/app-url";

const INTERNAL_HOST_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "id-preview--",
  "-dev.lovable.app",
  "lovableproject.com",
  "lovable.dev",
  "sandbox",
];

/** Origem pública e HTTPS para back_urls (o MP recusa domínios internos). */
export function publicOrigin(requestUrl: string): string {
  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/+$/, "");
  const candidates = [
    appUrl,
    (() => {
      try {
        return new URL(requestUrl).origin;
      } catch {
        return "";
      }
    })(),
  ];
  for (const origin of candidates) {
    if (!origin) continue;
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:") continue;
      if (INTERNAL_HOST_PATTERNS.some((p) => url.hostname.includes(p))) continue;
      return origin;
    } catch {
      /* ignora */
    }
  }
  return PUBLIC_APP_URL;
}

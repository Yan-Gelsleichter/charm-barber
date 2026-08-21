/**
 * POST para uma rota pública do app.
 *
 * No ambiente de preview do Lovable as rotas /api/public/* exigem sessão do
 * Lovable para visitantes anônimos (respondem com um redirecionamento para o
 * login). Nesse caso repetimos a chamada no domínio público publicado, onde a
 * rota é realmente aberta — assim a confirmação de pagamento funciona tanto no
 * preview quanto em produção.
 */
import { PUBLIC_APP_URL } from "@/lib/app-url";

type JsonBody = Record<string, unknown>;

async function readJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export async function postPublicApi<T>(
  path: string,
  body: JsonBody = {},
  token?: string | null,
): Promise<T | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const payload = JSON.stringify(body);

  // Em preview/desenvolvimento, executa primeiro no domínio publicado. Assim,
  // criação, preferência e reconciliação usam sempre as mesmas credenciais do
  // Mercado Pago e o webhook consulta a mesma conta que recebeu o pagamento.
  if (typeof window !== "undefined" && window.location.origin !== PUBLIC_APP_URL) {
    try {
      const res = await fetch(`${PUBLIC_APP_URL}${path}`, {
        method: "POST",
        headers,
        body: payload,
      });
      const parsed = await readJson<T>(res);
      if (parsed) return parsed;
    } catch {
      /* tenta a origem atual abaixo */
    }
  }

  try {
    const res = await fetch(path, { method: "POST", headers, body: payload });
    const parsed = await readJson<T>(res);
    if (parsed) return parsed;
  } catch {
    /* tenta o domínio público abaixo */
  }

  return null;
}

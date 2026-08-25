/** POST para uma rota pública da mesma versão do app que o cliente está usando. */

type JsonBody = Record<string, unknown>;

async function readJson<T>(res: Response): Promise<T | null> {
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

  try {
    const res = await fetch(path, {
      method: "POST",
      headers,
      body: payload,
      cache: "no-store",
    });
    return await readJson<T>(res);
  } catch {
    return null;
  }
}

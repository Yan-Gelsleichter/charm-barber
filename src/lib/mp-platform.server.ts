/**
 * Credenciais da plataforma (Mercado Pago) — SOMENTE PRODUÇÃO.
 *
 * O app usa exclusivamente MP_ACCESS_TOKEN e MP_PUBLIC_KEY de produção.
 * Não existe modo sandbox: qualquer chave de teste (TEST-...) é rejeitada
 * para eliminar risco de conflito ou cobrança em ambiente errado.
 */
export type MpCredentials = { accessToken: string; publicKey: string | null };

/** Chaves de teste do Mercado Pago começam com "TEST-". */
export function isTestCredential(value: string | null | undefined): boolean {
  return (value ?? "").trim().toUpperCase().startsWith("TEST-");
}

/** Ambiente da credencial. Mantido para telemetria/status; só "live" é aceito. */
export function credentialEnv(value: string | null | undefined): "test" | "live" | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return isTestCredential(v) ? "test" : "live";
}

/** Credenciais de produção da plataforma, quando configuradas. */
export function mpPlatformCredentials(): MpCredentials | null {
  const accessToken = (process.env["MP_ACCESS_TOKEN"] ?? "").trim();
  if (!accessToken || isTestCredential(accessToken)) return null;
  const publicKey = (process.env["MP_PUBLIC_KEY"] ?? "").trim();
  return {
    accessToken,
    publicKey: publicKey && !isTestCredential(publicKey) ? publicKey : null,
  };
}

/**
 * Valida que Access Token e Public Key existem e são ambos de produção.
 * Devolve a mensagem de erro (para o cliente) ou null quando está tudo certo.
 */
export function credentialMismatch(
  accessToken: string,
  publicKey: string | null,
): string | null {
  if (!accessToken?.trim()) return "Access Token do Mercado Pago ausente.";
  if (!publicKey?.trim()) return "Public Key do Mercado Pago ausente.";
  if (isTestCredential(accessToken) || isTestCredential(publicKey)) {
    return "Credenciais de teste (TEST-...) não são aceitas. Configure MP_ACCESS_TOKEN e MP_PUBLIC_KEY de produção.";
  }
  return null;
}

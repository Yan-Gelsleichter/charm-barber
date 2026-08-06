/**
 * Credenciais da plataforma (Mercado Pago).
 *
 * Quando MP_ACCESS_TOKEN está configurado, todas as cobranças usam essa conta
 * (e a MP_PUBLIC_KEY correspondente) em vez das contas conectadas via OAuth.
 * Nesse modo o split (application_fee) fica desligado.
 *
 * IMPORTANTE: a Public Key e o Access Token precisam ser do MESMO ambiente
 * (ambos de produção ou ambos TEST-...). Misturar chaves faz o gateway
 * devolver "internal_error" na tokenização/pagamento.
 */
export type MpCredentials = { accessToken: string; publicKey: string | null };

/** "test" para chaves TEST-..., "live" para chaves de produção. */
export function credentialEnv(value: string | null | undefined): "test" | "live" | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return v.toUpperCase().startsWith("TEST-") ? "test" : "live";
}

/** Credenciais fixas da plataforma, quando configuradas. */
export function mpPlatformCredentials(): MpCredentials | null {
  const accessToken = (process.env["MP_ACCESS_TOKEN"] ?? "").trim();
  if (!accessToken) return null;
  return {
    accessToken,
    publicKey: (process.env["MP_PUBLIC_KEY"] ?? "").trim() || null,
  };
}

/**
 * Valida que Public Key e Access Token pertencem ao mesmo ambiente.
 * Devolve a mensagem de erro (para o cliente) ou null quando está tudo certo.
 */
export function credentialMismatch(
  accessToken: string,
  publicKey: string | null,
): string | null {
  const tokenEnv = credentialEnv(accessToken);
  const keyEnv = credentialEnv(publicKey);
  if (!tokenEnv) return "Access Token do Mercado Pago ausente.";
  if (!keyEnv) return "Public Key do Mercado Pago ausente.";
  if (tokenEnv !== keyEnv) {
    return tokenEnv === "test"
      ? "Credenciais misturadas: o Access Token é de teste (TEST-...) mas a Public Key é de produção. Use as duas chaves do mesmo ambiente (MP_ACCESS_TOKEN e MP_PUBLIC_KEY)."
      : "Credenciais misturadas: o Access Token é de produção mas a Public Key é de teste (TEST-...). Use as duas chaves do mesmo ambiente (MP_ACCESS_TOKEN e MP_PUBLIC_KEY).";
  }
  return null;
}

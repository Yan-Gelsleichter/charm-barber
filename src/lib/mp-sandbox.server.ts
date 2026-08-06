/**
 * Modo de teste (sandbox) do Mercado Pago.
 *
 * Quando MP_SANDBOX está ligado, todas as cobranças usam as credenciais de
 * teste (MP_TEST_ACCESS_TOKEN / MP_TEST_PUBLIC_KEY) em vez das contas
 * conectadas via OAuth, para que os cartões de teste oficiais sejam aceitos.
 * O split (application_fee) é desligado, pois contas de teste não têm
 * marketplace habilitado.
 *
 * IMPORTANTE: a Public Key e o Access Token precisam ser do MESMO ambiente
 * (ambos TEST-... ou ambos de produção). Misturar chaves faz o gateway
 * devolver "internal_error" na tokenização/pagamento.
 */
export type MpSandbox = { accessToken: string; publicKey: string | null };

export function mpSandboxEnabled() {
  const flag = (process.env["MP_SANDBOX"] ?? "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/** "test" para chaves TEST-..., "live" para chaves de produção. */
export function credentialEnv(value: string | null | undefined): "test" | "live" | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return v.toUpperCase().startsWith("TEST-") ? "test" : "live";
}

export function mpSandbox(): MpSandbox | null {
  if (!mpSandboxEnabled()) return null;
  const accessToken = (process.env["MP_TEST_ACCESS_TOKEN"] ?? "").trim();
  if (!accessToken) return null;
  return {
    accessToken,
    publicKey: (process.env["MP_TEST_PUBLIC_KEY"] ?? "").trim() || null,
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
      ? "Credenciais misturadas: o Access Token é de teste (TEST-...) mas a Public Key é de produção. Use as duas chaves de teste do mesmo aplicativo no Mercado Pago."
      : "Credenciais misturadas: o Access Token é de produção mas a Public Key é de teste (TEST-...). Use as duas chaves do mesmo ambiente.";
  }
  if (mpSandboxEnabled() && tokenEnv !== "test") {
    return "O modo de teste está ligado, mas as credenciais configuradas são de produção. Configure MP_TEST_ACCESS_TOKEN e MP_TEST_PUBLIC_KEY com as chaves TEST- do mesmo aplicativo.";
  }
  return null;
}

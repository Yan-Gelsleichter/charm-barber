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

/* ------------------------------------------------------------------ *
 * Validação de ambiente (build/deploy + runtime)
 * ------------------------------------------------------------------ */

export type MpEnvReport = {
  ok: boolean;
  /** Erros que impedem aceitar pagamentos. */
  errors: string[];
  accessTokenEnv: "test" | "live" | null;
  publicKeyEnv: "test" | "live" | null;
};

/**
 * Confere se MP_ACCESS_TOKEN e MP_PUBLIC_KEY existem e são de PRODUÇÃO.
 * Usada tanto no check de build/deploy quanto nas rotas de pagamento.
 */
export function validateMpEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): MpEnvReport {
  const accessToken = (env["MP_ACCESS_TOKEN"] ?? "").trim();
  const publicKey = (env["MP_PUBLIC_KEY"] ?? "").trim();
  const errors: string[] = [];

  if (!accessToken) errors.push("MP_ACCESS_TOKEN não está configurado.");
  else if (isTestCredential(accessToken))
    errors.push("MP_ACCESS_TOKEN é uma chave de teste (TEST-...). Use a chave de produção.");

  if (!publicKey) errors.push("MP_PUBLIC_KEY não está configurada.");
  else if (isTestCredential(publicKey))
    errors.push("MP_PUBLIC_KEY é uma chave de teste (TEST-...). Use a chave de produção.");

  return {
    ok: errors.length === 0,
    errors,
    accessTokenEnv: credentialEnv(accessToken),
    publicKeyEnv: credentialEnv(publicKey),
  };
}

/** Mensagem única para o cliente quando o ambiente não está pronto, senão null. */
export function mpEnvGuardError(): string | null {
  const report = validateMpEnv();
  if (report.ok) return null;
  return `Pagamentos indisponíveis: configuração do Mercado Pago inválida. ${report.errors.join(" ")}`;
}

/**
 * Modo de teste (sandbox) do Mercado Pago.
 *
 * Quando MP_SANDBOX está ligado, todas as cobranças usam as credenciais de
 * teste (MP_TEST_ACCESS_TOKEN / MP_TEST_PUBLIC_KEY) em vez das contas
 * conectadas via OAuth, para que os cartões de teste oficiais sejam aceitos.
 * O split (application_fee) é desligado, pois contas de teste não têm
 * marketplace habilitado.
 */
export type MpSandbox = { accessToken: string; publicKey: string | null };

export function mpSandbox(): MpSandbox | null {
  const flag = (process.env["MP_SANDBOX"] ?? "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1" && flag !== "yes") return null;
  const accessToken = (process.env["MP_TEST_ACCESS_TOKEN"] ?? "").trim();
  if (!accessToken) return null;
  return {
    accessToken,
    publicKey: (process.env["MP_TEST_PUBLIC_KEY"] ?? "").trim() || null,
  };
}

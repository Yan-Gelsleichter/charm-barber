#!/usr/bin/env node
/**
 * Checagem de build/deploy das credenciais do Mercado Pago.
 *
 * - Falha o build se as chaves existirem mas forem de TESTE (TEST-...).
 * - Falha também quando ausentes se MP_ENV_STRICT=1 (use no deploy de produção).
 * - Caso contrário apenas avisa (ambientes de preview sem segredos injetados).
 */
const isTest = (v) => (v ?? "").trim().toUpperCase().startsWith("TEST-");
const accessToken = (process.env.MP_ACCESS_TOKEN ?? "").trim();
const publicKey = (process.env.MP_PUBLIC_KEY ?? "").trim();

const missing = [];
const invalid = [];
if (!accessToken) missing.push("MP_ACCESS_TOKEN");
else if (isTest(accessToken)) invalid.push("MP_ACCESS_TOKEN (chave de teste TEST-...)");
if (!publicKey) missing.push("MP_PUBLIC_KEY");
else if (isTest(publicKey)) invalid.push("MP_PUBLIC_KEY (chave de teste TEST-...)");

const strict = process.env.MP_ENV_STRICT === "1";

if (invalid.length) {
  console.error(`[mp-env] Credenciais de teste detectadas: ${invalid.join(", ")}. Use as chaves de produção.`);
  process.exit(1);
}
if (missing.length) {
  const msg = `[mp-env] Ausentes: ${missing.join(", ")}. Pagamentos ficarão bloqueados em runtime.`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
} else {
  console.log("[mp-env] OK — MP_ACCESS_TOKEN e MP_PUBLIC_KEY de produção presentes.");
}

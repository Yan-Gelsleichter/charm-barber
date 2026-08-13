/**
 * O Mercado Pago exige `payer.email` em todo pagamento criado por API
 * (PIX, cartão novo, cartão salvo e qualquer reprocessamento/retentativa).
 * Centralizamos aqui a resolução e a validação para que nenhuma rota envie
 * a cobrança sem esse dado.
 */

export const PAYER_EMAIL_ERROR =
  "Não encontramos um e-mail válido no seu cadastro. Atualize seu e-mail no perfil e tente novamente.";

export function isValidEmail(value: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

/** Primeiro e-mail válido entre a sessão, o agendamento e o cadastro. */
export function resolvePayerEmail(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const email = String(candidate ?? "").trim().toLowerCase();
    if (isValidEmail(email)) return email;
  }
  return null;
}

/**
 * Validação server-side do objeto `payer` completo.
 *
 * O antifraude do Mercado Pago recusa (cc_rejected_high_risk) cobranças sem
 * nome, CPF, e-mail, telefone e endereço do pagador. Nenhuma rota deve criar
 * pagamento sem passar por aqui — a checagem no navegador pode ser burlada.
 */
export type MpPayerPhone = { area_code: string; number: string };

export type MpPayerAddress = {
  zip_code: string;
  street_name: string;
  street_number: string;
  neighborhood?: string | undefined;
  city?: string | undefined;
  federal_unit?: string | undefined;
};

export type MpPayerCandidate = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  doc?: string | null;
  phone?: MpPayerPhone | null;
  address?: MpPayerAddress | null;
};

function isValidCpfDigits(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 || rest === 11 ? 0 : rest;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Devolve a mensagem do primeiro campo inválido/ausente, ou null se completo. */
export function validatePayerComplete(payer: MpPayerCandidate): string | null {
  const fullName = `${payer.first_name ?? ""} ${payer.last_name ?? ""}`.trim();
  if (fullName.replace(/\s+/g, "").length < 3) {
    return "Informe o nome completo do titular do cartão.";
  }

  if (!isValidCpfDigits(String(payer.doc ?? ""))) {
    return "CPF do titular inválido ou ausente. Confira o CPF informado e tente novamente.";
  }

  if (!isValidEmail(payer.email)) return PAYER_EMAIL_ERROR;

  const area = String(payer.phone?.area_code ?? "").replace(/\D/g, "");
  const number = String(payer.phone?.number ?? "").replace(/\D/g, "");
  if (area.length < 2 || number.length < 8) {
    return "Informe um telefone válido com DDD para concluir o pagamento.";
  }

  const zip = String(payer.address?.zip_code ?? "").replace(/\D/g, "");
  if (zip.length !== 8) return "Informe um CEP válido com 8 dígitos.";
  if (!String(payer.address?.street_name ?? "").trim()) {
    return "Não foi possível confirmar o endereço do CEP informado.";
  }
  if (!String(payer.address?.street_number ?? "").trim()) {
    return "Informe o número do endereço de cobrança.";
  }

  return null;
}

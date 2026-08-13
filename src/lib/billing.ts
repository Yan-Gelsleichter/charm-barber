/**
 * Validação do endereço de cobrança e do telefone do pagador.
 *
 * O Mercado Pago recusa cobranças (cc_rejected_high_risk) quando o `payer`
 * chega incompleto ou com dados fora do formato. Centralizamos aqui as regras
 * para que o formulário e o payload enviado usem sempre o mesmo critério.
 */

import { cepDigits, isValidCEP } from "@/lib/cep";
import { phoneDigits } from "@/lib/format";

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type BillingAddress = {
  zip: string;
  number: string;
  street: string;
  neighborhood: string;
  city: string;
  uf: string;
};

export type BillingErrors = Partial<
  Record<"zip" | "number" | "street" | "neighborhood" | "city" | "uf" | "phone", string>
>;

/** Mensagens de erro por campo; objeto vazio quando tudo está válido. */
export function validateBilling(addr: BillingAddress, phone: string): BillingErrors {
  const errors: BillingErrors = {};

  const zip = cepDigits(addr.zip);
  if (!zip) errors.zip = "Informe o CEP.";
  else if (!isValidCEP(zip)) errors.zip = "O CEP deve ter 8 dígitos.";

  const street = addr.street.trim();
  if (!street) errors.street = "Informe a rua.";
  else if (street.length < 3) errors.street = "Rua muito curta.";

  const number = addr.number.trim();
  if (!number) errors.number = "Informe o número (use S/N se não houver).";
  else if (!/^[\p{L}\p{N}/-]{1,10}$/u.test(number)) errors.number = "Número inválido.";

  const neighborhood = addr.neighborhood.trim();
  if (!neighborhood) errors.neighborhood = "Informe o bairro.";
  else if (neighborhood.length < 2) errors.neighborhood = "Bairro muito curto.";

  const city = addr.city.trim();
  if (!city) errors.city = "Informe a cidade.";
  else if (city.length < 2) errors.city = "Cidade muito curta.";

  const uf = addr.uf.trim().toUpperCase();
  if (!uf) errors.uf = "Informe a UF.";
  else if (!(UFS as readonly string[]).includes(uf)) errors.uf = "UF inválida (ex.: SP).";

  const tel = phoneDigits(phone);
  if (!tel) errors.phone = "Informe o telefone com DDD.";
  else if (tel.length < 10) errors.phone = "Telefone incompleto (DDD + número).";
  else if (tel.length > 11) errors.phone = "Telefone inválido.";
  else if (Number(tel.slice(0, 2)) < 11) errors.phone = "DDD inválido.";

  return errors;
}

export function hasBillingErrors(errors: BillingErrors): boolean {
  return Object.keys(errors).length > 0;
}

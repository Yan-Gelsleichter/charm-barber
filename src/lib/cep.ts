/**
 * Consulta de endereço por CEP (ViaCEP).
 *
 * O antifraude do Mercado Pago pontua melhor quando o pagamento chega com o
 * endereço completo do pagador. Aqui o cliente digita apenas o CEP e o número
 * da casa: rua, bairro, cidade e estado vêm preenchidos automaticamente.
 */

export type Endereco = {
  street_name: string;
  neighborhood: string;
  city: string;
  federal_unit: string;
};

export function maskCEP(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function cepDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function isValidCEP(value: string): boolean {
  return /^\d{8}$/.test(cepDigits(value));
}

/** Busca o endereço no ViaCEP. Lança Error com mensagem amigável em falha. */
export async function lookupCEP(value: string): Promise<Endereco> {
  const cep = cepDigits(value);
  if (!isValidCEP(cep)) throw new Error("Informe um CEP com 8 dígitos.");
  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!response.ok) throw new Error("Não foi possível consultar o CEP agora.");
  const data = (await response.json().catch(() => null)) as
    | { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
    | null;
  if (!data || data.erro) throw new Error("CEP não encontrado. Confira os números digitados.");
  return {
    street_name: String(data.logradouro ?? "").trim(),
    neighborhood: String(data.bairro ?? "").trim(),
    city: String(data.localidade ?? "").trim(),
    federal_unit: String(data.uf ?? "").trim().toUpperCase(),
  };
}

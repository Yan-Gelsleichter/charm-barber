export function maskPhoneBR(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function brl(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

export function fmtDate(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function fmtTime(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(d: Date | string): string {
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

export const EMAIL_SUGGESTIONS = ["@gmail.com", "@yahoo.com", "@hotmail.com", "@outlook.com"];

export const DIAS_SEMANA = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

/** Máscara de CPF: 000.000.000-00 */
export function maskCPF(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Valida CPF pelos dígitos verificadores (algoritmo oficial da Receita). */
export function isValidCPF(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 || rest === 11 ? 0 : rest;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Mensagem de erro do CPF do titular ou null quando válido. */
export function validateCPF(value: string): string | null {
  const d = value.replace(/\D/g, "");
  if (!d) return "Informe o CPF do titular.";
  if (d.length < 11) return "O CPF deve ter 11 dígitos.";
  if (!isValidCPF(d)) return "CPF inválido. Confira os números digitados.";
  return null;
}

/**
 * Normalização de textos enviados ao Mercado Pago.
 * Remove caracteres de controle, colapsa espaços repetidos e corta o excesso —
 * o antifraude recusa payloads com espaços sobrando ou caracteres inválidos.
 */
export function normalizeText(value: string | null | undefined, max = 120): string {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Nome de rua/bairro/cidade: só letras (com acento), números e pontuação simples. */
export function maskAddressText(value: string, max = 120): string {
  return normalizeText(value.replace(/[^\p{L}\p{N}\s.,'’\-/º°]/gu, ""), max);
}

/** Número do endereço: dígitos e letras curtas (ex.: 123B, S/N). */
export function maskAddressNumber(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}/\-]/gu, "")
    .toUpperCase()
    .slice(0, 10);
}

/** UF: duas letras maiúsculas. */
export function maskUF(value: string): string {
  return value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);
}

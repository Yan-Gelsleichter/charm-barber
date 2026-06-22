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

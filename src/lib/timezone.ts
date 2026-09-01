/**
 * O app é sempre para barbearias no horário de Brasília (America/Sao_Paulo).
 * O Brasil não usa mais horário de verão desde 2019, então o deslocamento é
 * fixo (UTC-3) — não precisa de uma base de fusos horários pra isso.
 */
export const BRAZIL_TIME_ZONE = "America/Sao_Paulo";
const BRAZIL_UTC_OFFSET_HOURS = 3;

/**
 * Constrói o instante UTC correto para um horário "HH:MM" (sempre hora de
 * Brasília) no dia indicado por `date` — sem depender do fuso horário
 * configurado no aparelho de quem está usando o site. Só o ano/mês/dia de
 * `date` são usados (o horário dele é ignorado).
 */
export function brazilDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), h + BRAZIL_UTC_OFFSET_HOURS, m || 0, 0, 0),
  );
}

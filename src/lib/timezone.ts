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

/**
 * "Agora", mas lido como se fosse um relógio de Brasília — não é um
 * instante real, é só um jeito de extrair ano/mês/dia/hora "como em
 * Brasília" usando os getters UTC (pra nunca depender do fuso do
 * navegador/servidor rodando o código).
 */
function brazilWallClock(instant: Date = new Date()): Date {
  return new Date(instant.getTime() - BRAZIL_UTC_OFFSET_HOURS * 3_600_000);
}

/** Início do dia (00:00 em Brasília) que contém `instant`, como instante real. */
export function brazilStartOfDay(instant: Date = new Date()): Date {
  const wall = brazilWallClock(instant);
  return new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0),
  );
}

/** Dia da semana (0 = domingo) do dia de Brasília que contém `instant`. */
export function brazilWeekday(instant: Date = new Date()): number {
  return brazilWallClock(instant).getUTCDay();
}

/** Início da semana (domingo, 00:00 em Brasília) que contém `instant`. */
export function brazilStartOfWeek(instant: Date = new Date()): Date {
  const start = brazilStartOfDay(instant);
  return new Date(start.getTime() - brazilWeekday(instant) * 86_400_000);
}

/** Início do mês (dia 1, 00:00 em Brasília) que contém `instant`. */
export function brazilStartOfMonth(instant: Date = new Date()): Date {
  const wall = brazilWallClock(instant);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

/** Início do ano (1º de janeiro, 00:00 em Brasília) que contém `instant`. */
export function brazilStartOfYear(instant: Date = new Date()): Date {
  const wall = brazilWallClock(instant);
  return new Date(Date.UTC(wall.getUTCFullYear(), 0, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

/** "YYYY-MM-DD" do dia de calendário de Brasília que contém `instant`. */
export function brazilDateKey(instant: Date = new Date()): string {
  return brazilStartOfDay(instant).toISOString().slice(0, 10);
}

/**
 * Início e fim (23:59:59.999) do dia de calendário `year-month0-day`,
 * sempre em Brasília — usado, por exemplo, para um seletor de data
 * "AAAA-MM-DD" (que não carrega fuso nenhum) virar um período correto.
 */
export function brazilDayBounds(year: number, month0: number, day: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month0, day, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0)),
    end: new Date(Date.UTC(year, month0, day, 23 + BRAZIL_UTC_OFFSET_HOURS, 59, 59, 999)),
  };
}

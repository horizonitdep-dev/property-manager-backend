/**
 * Date arithmetic for the finance reports.
 *
 * Every date column in Finance is `@db.Date`, which Prisma hands back as a Date
 * pinned to UTC midnight. All arithmetic here therefore stays in UTC: using
 * local-time getters in Abu Dhabi (UTC+4) would read a stored 2026-04-01 as
 * 2026-04-01T04:00 local and, near month boundaries, shift a due date by a day —
 * which would quietly move rent into the wrong quarter.
 */

/** Strips any time component, keeping the calendar day as UTC midnight. */
export function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Adds whole months, clamping the day to the end of the target month so
 * 31 January + 1 month is 28/29 February rather than rolling into March — a
 * quarterly schedule starting on the 31st must not skip a month.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const lastDayOfTarget = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month + months, Math.min(day, lastDayOfTarget)));
}

/** Whole months from `from` to `to`, ignoring the day-of-month remainder. Negative when reversed. */
export function monthsBetween(from: Date, to: Date): number {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();
  const total = years * 12 + months;

  // Not a full month yet if the day-of-month has not been reached.
  return to.getUTCDate() < from.getUTCDate() ? total - 1 : total;
}

export function isOnOrBefore(a: Date, b: Date): boolean {
  return toUtcDay(a).getTime() <= toUtcDay(b).getTime();
}

export function isOnOrAfter(a: Date, b: Date): boolean {
  return toUtcDay(a).getTime() >= toUtcDay(b).getTime();
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((toUtcDay(to).getTime() - toUtcDay(from).getTime()) / MS_PER_DAY);
}

/** The calendar year a date falls in, in UTC. */
export function utcYear(date: Date): number {
  return date.getUTCFullYear();
}

/** ISO yyyy-mm-dd, the form the API returns dates in. */
export function toIsoDate(date: Date): string {
  return toUtcDay(date).toISOString().slice(0, 10);
}

export type PnlGrouping = 'building' | 'property' | 'month' | 'quarter' | 'year';

/**
 * The bucket key a date falls into for a time-based P&L grouping.
 * Quarters are calendar quarters (Q1 = Jan–Mar), not contract-relative ones.
 */
export function periodKey(date: Date, grouping: 'month' | 'quarter' | 'year'): string {
  const year = date.getUTCFullYear();

  if (grouping === 'year') return String(year);
  if (grouping === 'month') return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

  return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

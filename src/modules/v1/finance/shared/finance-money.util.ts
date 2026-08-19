import { Prisma } from '@prisma/client';

/**
 * Money handling for the Finance module.
 *
 * Every monetary column is Decimal(12,2). Prisma hands those back as
 * Prisma.Decimal (decimal.js), NOT as a JS number — which is the point: a
 * double cannot represent 0.1 exactly, and summing thousands of rent payments
 * in floating point drifts. All arithmetic here stays in Decimal.
 *
 * Spec §8: do not round in transport DTOs; round only at report display.
 */

/** Two decimal places, matching the Decimal(12,2) columns. */
export const MONEY_SCALE = 2;

export type MoneyInput = Prisma.Decimal | number | string;

export function toDecimal(value: MoneyInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/**
 * The wire representation of an amount: a STRING, not a number.
 *
 * JSON numbers are IEEE-754 doubles, so anything past 2^53 silently loses
 * precision and 0.1 + 0.2 style drift creeps in on the client. A string round
 * trips exactly and is what the frontend should feed back to us. Always exactly
 * two decimals so amounts render consistently without client-side formatting.
 */
export function toMoneyString(value: MoneyInput | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toDecimal(value).toFixed(MONEY_SCALE);
}

/** Sums money without ever leaving Decimal. Empty list → 0.00. */
export function sumMoney(values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (total, value) => total.plus(toDecimal(value)),
    new Prisma.Decimal(0),
  );
}

/**
 * Rounds to the money scale using half-up, the convention people expect on an
 * invoice. decimal.js defaults to half-even (banker's rounding), which would
 * round 2.345 down to 2.34 and surprise anyone reconciling by hand.
 */
export function roundMoney(value: MoneyInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** True when the amount is strictly greater than zero. */
export function isPositiveMoney(value: MoneyInput): boolean {
  return toDecimal(value).greaterThan(0);
}

/**
 * Outstanding balances are never reported as negative — an overpayment is shown
 * separately as a credit rather than as negative debt (spec §7). This clamps the
 * debt side; use creditOf() for the other half so the two always agree.
 */
export function clampToZero(value: MoneyInput): Prisma.Decimal {
  const decimal = toDecimal(value);
  return decimal.isNegative() ? new Prisma.Decimal(0) : decimal;
}

/** The overpaid portion of a balance, as a positive number. Zero when not overpaid. */
export function creditOf(value: MoneyInput): Prisma.Decimal {
  const decimal = toDecimal(value);
  return decimal.isNegative() ? decimal.negated() : new Prisma.Decimal(0);
}

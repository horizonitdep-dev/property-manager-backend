import { Prisma } from '@prisma/client';
import { PaymentFrequency } from '../../../../../common/enums/payment-frequency.enum';
import { clampToZero, creditOf, roundMoney, sumMoney } from '../../shared/finance-money.util';
import { addMonths, isOnOrBefore, monthsBetween, toUtcDay } from './date-range.helper';

/**
 * Outstanding rent, by installment rather than by day.
 *
 * ── The rule (confirmed with the client) ───────────────────────────────────
 * Rent falls due in INSTALLMENTS, not continuously. A tenant on 40,000/year
 * across four cheques owes 10,000 on each quarter's due date and nothing in
 * between. Having paid the first 10,000, they are square until the second due
 * date arrives — at which point the next 10,000 becomes due and the owner needs
 * reminding.
 *
 * This deliberately differs from the "monthlyRent × monthsElapsed" formula in
 * spec §7, which would show that same tenant in arrears for most of every
 * quarter and make the arrears report unusable for chasing.
 *
 * ── The calculation ────────────────────────────────────────────────────────
 *   installments   = derived from paymentFrequency (or numberOfCheques)
 *   expectedToDate = Σ installment.amount where installment.dueOn ≤ asOfDate
 *   receivedToDate = Σ RENT payments where paidOn ≤ asOfDate  (soft-deleted excluded,
 *                    so a bounced cheque's voided payment correctly stops counting)
 *   outstanding    = max(0, expectedToDate − receivedToDate)
 *   credit         = max(0, receivedToDate − expectedToDate)   // overpayment, shown separately
 *
 * Rounding: the per-installment amount is rounded to 2dp and any remainder is
 * added to the FINAL installment, so the schedule always sums to the contract
 * total exactly rather than drifting a few fils.
 */

export interface RentInstallment {
  /** 1-based position in the schedule. */
  number: number;
  dueOn: Date;
  amount: Prisma.Decimal;
}

export interface ContractRentTerms {
  startDate: Date;
  endDate: Date;
  annualRent: Prisma.Decimal;
  paymentFrequency: PaymentFrequency;
  numberOfCheques: number | null;
}

/** How many months one installment covers, for the fixed-cadence frequencies. */
const MONTHS_PER_PERIOD: Partial<Record<PaymentFrequency, number>> = {
  [PaymentFrequency.MONTHLY]: 1,
  [PaymentFrequency.QUARTERLY]: 3,
  [PaymentFrequency.BI_ANNUAL]: 6,
  [PaymentFrequency.ANNUAL]: 12,
};

/**
 * Contract length in whole months, minimum 1.
 *
 * endDate is INCLUSIVE — it is the last day of the tenancy, so a one-year lease
 * runs 2026-01-01 to 2026-12-31. Measuring straight between those two dates
 * gives 11 months and would price that lease at 11/12 of its annual rent, so the
 * end date is advanced by a day before measuring.
 */
export function contractTermMonths(terms: ContractRentTerms): number {
  const start = toUtcDay(terms.startDate);
  const dayAfterEnd = addDays(toUtcDay(terms.endDate), 1);
  return Math.max(1, monthsBetween(start, dayAfterEnd));
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/**
 * The total rent for the whole contract term, scaled from the annual figure.
 * A 24-month contract at 40,000/year owes 80,000 across its schedule.
 */
export function contractTotalRent(terms: ContractRentTerms): Prisma.Decimal {
  const months = contractTermMonths(terms);
  return roundMoney(new Prisma.Decimal(terms.annualRent).times(months).dividedBy(12));
}

/**
 * The full due-date schedule for a contract.
 *
 * CHEQUES uses numberOfCheques as the installment count spread evenly across the
 * term — the cheque dates themselves are not used, because a cheque may not have
 * been recorded yet and the money is still due regardless.
 * SINGLE_PAYMENT is one installment due at the start.
 */
export function buildRentSchedule(terms: ContractRentTerms): RentInstallment[] {
  const start = toUtcDay(terms.startDate);
  const termMonths = contractTermMonths(terms);
  const total = contractTotalRent(terms);

  const { count, monthsPerPeriod } = resolveCadence(terms, termMonths);

  const perInstallment = roundMoney(total.dividedBy(count));
  const installments: RentInstallment[] = [];

  for (let index = 0; index < count; index++) {
    const isLast = index === count - 1;
    installments.push({
      number: index + 1,
      dueOn: addMonths(start, index * monthsPerPeriod),
      // The last installment absorbs the rounding remainder so the schedule
      // sums to `total` to the fils.
      amount: isLast ? total.minus(perInstallment.times(count - 1)) : perInstallment,
    });
  }

  return installments;
}

function resolveCadence(
  terms: ContractRentTerms,
  termMonths: number,
): { count: number; monthsPerPeriod: number } {
  if (terms.paymentFrequency === PaymentFrequency.SINGLE_PAYMENT) {
    return { count: 1, monthsPerPeriod: termMonths };
  }

  if (terms.paymentFrequency === PaymentFrequency.CHEQUES) {
    // Fall back to quarterly when the count is missing — the common UAE cadence,
    // and better than treating the whole year as due on day one.
    const count = terms.numberOfCheques && terms.numberOfCheques > 0 ? terms.numberOfCheques : 4;
    return { count, monthsPerPeriod: Math.max(1, Math.round(termMonths / count)) };
  }

  const monthsPerPeriod = MONTHS_PER_PERIOD[terms.paymentFrequency] ?? 12;
  const count = Math.max(1, Math.ceil(termMonths / monthsPerPeriod));
  return { count, monthsPerPeriod };
}

export interface OutstandingBreakdown {
  expectedToDate: Prisma.Decimal;
  receivedToDate: Prisma.Decimal;
  /** Never negative — an overpayment appears as `credit` instead. */
  outstanding: Prisma.Decimal;
  credit: Prisma.Decimal;
  installmentsDue: number;
  installmentsTotal: number;
  /** The next installment not yet due as of asOfDate; null once the schedule is exhausted. */
  nextDue: RentInstallment | null;
  /** Whole days until nextDue; negative is impossible since nextDue is always future. */
  daysUntilNextDue: number | null;
  /** True when money is owed right now — what drives the owner's reminder. */
  isOverdue: boolean;
}

export function calculateOutstanding(
  terms: ContractRentTerms,
  rentPaymentsToDate: Prisma.Decimal[],
  asOfDate: Date,
): OutstandingBreakdown {
  const asOf = toUtcDay(asOfDate);
  const schedule = buildRentSchedule(terms);

  const due = schedule.filter((installment) => isOnOrBefore(installment.dueOn, asOf));
  const expectedToDate = sumMoney(due.map((installment) => installment.amount));
  const receivedToDate = sumMoney(rentPaymentsToDate);

  const balance = expectedToDate.minus(receivedToDate);
  const nextDue = schedule.find((installment) => !isOnOrBefore(installment.dueOn, asOf)) ?? null;

  return {
    expectedToDate,
    receivedToDate,
    outstanding: clampToZero(balance),
    credit: creditOf(balance),
    installmentsDue: due.length,
    installmentsTotal: schedule.length,
    nextDue,
    daysUntilNextDue: nextDue ? daysUntil(asOf, nextDue.dueOn) : null,
    isOverdue: balance.greaterThan(0),
  };
}

function daysUntil(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((toUtcDay(to).getTime() - toUtcDay(from).getTime()) / MS_PER_DAY);
}

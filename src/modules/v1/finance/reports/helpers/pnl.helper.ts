import { Prisma } from '@prisma/client';
import { ExpenseCategory } from '../../../../../common/enums/expense-category.enum';
import { PaymentKind } from '../../../../../common/enums/payment-kind.enum';
import { sumMoney } from '../../shared/finance-money.util';
import { PnlGrouping, periodKey } from './date-range.helper';

/**
 * P&L aggregation.
 *
 * Revenue is money actually received in the window, not billed — Finance records
 * payments only when money arrives, so there is no accrual side to reconcile.
 *
 * REFUND payments are stored as positive amounts but represent money going OUT
 * (a deposit returned, an overpayment sent back), so they are SUBTRACTED from
 * revenue rather than added. Getting that sign wrong would overstate revenue by
 * twice the refund.
 */

export interface PnlPaymentRow {
  amount: Prisma.Decimal;
  kind: PaymentKind;
  paidOn: Date;
  buildingId: string;
  buildingLabel: string;
  propertyId: string;
  propertyLabel: string;
}

export interface PnlExpenseRow {
  amount: Prisma.Decimal;
  category: ExpenseCategory;
  incurredOn: Date;
  buildingId: string;
  buildingLabel: string;
  propertyId: string | null;
  propertyLabel: string | null;
}

export interface PnlBucket {
  key: string;
  label: string;
  revenue: Prisma.Decimal;
  refunds: Prisma.Decimal;
  expenses: Prisma.Decimal;
  net: Prisma.Decimal;
  expensesByCategory: { category: ExpenseCategory; amount: Prisma.Decimal }[];
}

/** Positive money in: everything except refunds. */
export function grossRevenue(payments: PnlPaymentRow[]): Prisma.Decimal {
  return sumMoney(
    payments.filter((p) => p.kind !== PaymentKind.REFUND).map((p) => p.amount),
  );
}

/** Money handed back, as a positive figure. */
export function totalRefunds(payments: PnlPaymentRow[]): Prisma.Decimal {
  return sumMoney(payments.filter((p) => p.kind === PaymentKind.REFUND).map((p) => p.amount));
}

export function totalExpenses(expenses: PnlExpenseRow[]): Prisma.Decimal {
  return sumMoney(expenses.map((e) => e.amount));
}

export function expensesByCategory(
  expenses: PnlExpenseRow[],
): { category: ExpenseCategory; amount: Prisma.Decimal }[] {
  const totals = new Map<ExpenseCategory, Prisma.Decimal>();

  for (const expense of expenses) {
    const running = totals.get(expense.category) ?? new Prisma.Decimal(0);
    totals.set(expense.category, running.plus(expense.amount));
  }

  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

/**
 * Splits both sides into buckets and totals each.
 *
 * A property-grouped P&L includes building-wide expenses under a synthetic
 * "(building-wide)" bucket rather than silently dropping them or spreading them
 * across units — an apportionment rule is a business decision nobody has made.
 */
export function buildPnlBuckets(
  payments: PnlPaymentRow[],
  expenses: PnlExpenseRow[],
  grouping: PnlGrouping,
): PnlBucket[] {
  const buckets = new Map<string, { label: string; payments: PnlPaymentRow[]; expenses: PnlExpenseRow[] }>();

  const ensure = (key: string, label: string) => {
    if (!buckets.has(key)) buckets.set(key, { label, payments: [], expenses: [] });
    return buckets.get(key)!;
  };

  for (const payment of payments) {
    const { key, label } = paymentBucket(payment, grouping);
    ensure(key, label).payments.push(payment);
  }

  for (const expense of expenses) {
    const { key, label } = expenseBucket(expense, grouping);
    ensure(key, label).expenses.push(expense);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const revenue = grossRevenue(bucket.payments);
      const refunds = totalRefunds(bucket.payments);
      const expenseTotal = totalExpenses(bucket.expenses);

      return {
        key,
        label: bucket.label,
        revenue,
        refunds,
        expenses: expenseTotal,
        net: revenue.minus(refunds).minus(expenseTotal),
        expensesByCategory: expensesByCategory(bucket.expenses),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function paymentBucket(payment: PnlPaymentRow, grouping: PnlGrouping): { key: string; label: string } {
  if (grouping === 'building') return { key: payment.buildingId, label: payment.buildingLabel };
  if (grouping === 'property') return { key: payment.propertyId, label: payment.propertyLabel };

  const key = periodKey(payment.paidOn, grouping);
  return { key, label: key };
}

function expenseBucket(expense: PnlExpenseRow, grouping: PnlGrouping): { key: string; label: string } {
  if (grouping === 'building') return { key: expense.buildingId, label: expense.buildingLabel };

  if (grouping === 'property') {
    return expense.propertyId
      ? { key: expense.propertyId, label: expense.propertyLabel ?? expense.propertyId }
      : // Building-wide costs have no unit to sit under; surfaced explicitly rather
        // than apportioned, since no apportionment rule has been agreed.
        { key: `building-wide:${expense.buildingId}`, label: `${expense.buildingLabel} (building-wide)` };
  }

  const key = periodKey(expense.incurredOn, grouping);
  return { key, label: key };
}

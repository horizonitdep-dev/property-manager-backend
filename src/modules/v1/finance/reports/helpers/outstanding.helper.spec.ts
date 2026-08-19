import { Prisma } from '@prisma/client';
import { PaymentFrequency } from '../../../../../common/enums/payment-frequency.enum';
import {
  ContractRentTerms,
  buildRentSchedule,
  calculateOutstanding,
  contractTotalRent,
} from './outstanding.helper';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const money = (value: string | number) => new Prisma.Decimal(value);

/** The client's worked example: 40,000/year over four quarterly installments. */
const quarterly: ContractRentTerms = {
  startDate: d('2026-01-01'),
  endDate: d('2026-12-31'),
  annualRent: money(40000),
  paymentFrequency: PaymentFrequency.QUARTERLY,
  numberOfCheques: null,
};

describe('rent schedule', () => {
  it('splits 40,000 into four 10,000 quarterly installments', () => {
    const schedule = buildRentSchedule(quarterly);

    expect(schedule).toHaveLength(4);
    expect(schedule.map((i) => i.amount.toFixed(2))).toEqual([
      '10000.00',
      '10000.00',
      '10000.00',
      '10000.00',
    ]);
  });

  it('places the due dates a quarter apart from the contract start', () => {
    const schedule = buildRentSchedule(quarterly);

    expect(schedule.map((i) => i.dueOn.toISOString().slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ]);
  });

  it('always sums to the contract total, putting the remainder on the last installment', () => {
    // 10,000 / 3 does not divide evenly — 3333.33 × 3 would lose a fils.
    const schedule = buildRentSchedule({
      ...quarterly,
      annualRent: money(10000),
      paymentFrequency: PaymentFrequency.CHEQUES,
      numberOfCheques: 3,
    });

    const total = schedule.reduce((sum, i) => sum.plus(i.amount), money(0));
    expect(total.toFixed(2)).toBe('10000.00');
    expect(schedule[2].amount.toFixed(2)).toBe('3333.34');
  });

  it('scales a multi-year contract from the annual figure', () => {
    const twoYears = { ...quarterly, endDate: d('2027-12-31') };

    expect(contractTotalRent(twoYears).toFixed(2)).toBe('80000.00');
    expect(buildRentSchedule(twoYears)).toHaveLength(8);
  });

  it('uses numberOfCheques as the installment count for CHEQUES contracts', () => {
    const schedule = buildRentSchedule({
      ...quarterly,
      paymentFrequency: PaymentFrequency.CHEQUES,
      numberOfCheques: 6,
    });

    expect(schedule).toHaveLength(6);
  });

  it('falls back to quarterly when a CHEQUES contract has no cheque count', () => {
    // Better than treating the whole year as due on day one.
    const schedule = buildRentSchedule({
      ...quarterly,
      paymentFrequency: PaymentFrequency.CHEQUES,
      numberOfCheques: null,
    });

    expect(schedule).toHaveLength(4);
  });

  it('treats SINGLE_PAYMENT as one installment due at the start', () => {
    const schedule = buildRentSchedule({
      ...quarterly,
      paymentFrequency: PaymentFrequency.SINGLE_PAYMENT,
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0].amount.toFixed(2)).toBe('40000.00');
    expect(schedule[0].dueOn.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('produces twelve installments for a monthly contract', () => {
    expect(buildRentSchedule({ ...quarterly, paymentFrequency: PaymentFrequency.MONTHLY })).toHaveLength(12);
  });

  it('does not skip a month when the contract starts on the 31st', () => {
    const schedule = buildRentSchedule({
      ...quarterly,
      startDate: d('2026-01-31'),
      endDate: d('2027-01-30'),
      paymentFrequency: PaymentFrequency.MONTHLY,
    });

    // Naive month addition would roll 31 Jan into 3 March and lose February.
    expect(schedule[1].dueOn.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(schedule[2].dueOn.toISOString().slice(0, 10)).toBe('2026-03-31');
  });
});

describe('outstanding — the client scenario', () => {
  it('shows nothing owed after the first quarter is paid', () => {
    const result = calculateOutstanding(quarterly, [money(10000)], d('2026-02-15'));

    expect(result.expectedToDate.toFixed(2)).toBe('10000.00');
    expect(result.receivedToDate.toFixed(2)).toBe('10000.00');
    expect(result.outstanding.toFixed(2)).toBe('0.00');
    expect(result.isOverdue).toBe(false);
  });

  it('does NOT accrue rent day-by-day between installments', () => {
    // The rejected §7 formula would report 1.5 months ≈ 5,000 owing here.
    const result = calculateOutstanding(quarterly, [money(10000)], d('2026-02-15'));

    expect(result.outstanding.toFixed(2)).toBe('0.00');
  });

  it('flags the second quarter as owing once April arrives', () => {
    const result = calculateOutstanding(quarterly, [money(10000)], d('2026-04-01'));

    expect(result.expectedToDate.toFixed(2)).toBe('20000.00');
    expect(result.outstanding.toFixed(2)).toBe('10000.00');
    expect(result.isOverdue).toBe(true);
  });

  it('surfaces the next due date and amount so the owner can be reminded', () => {
    const result = calculateOutstanding(quarterly, [money(10000)], d('2026-02-15'));

    expect(result.nextDue?.dueOn.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(result.nextDue?.amount.toFixed(2)).toBe('10000.00');
    expect(result.daysUntilNextDue).toBe(45);
  });

  it('counts how many installments have come due', () => {
    const result = calculateOutstanding(quarterly, [], d('2026-07-01'));

    expect(result.installmentsDue).toBe(3);
    expect(result.installmentsTotal).toBe(4);
    expect(result.expectedToDate.toFixed(2)).toBe('30000.00');
  });

  it('has no next due date once the final installment has passed', () => {
    const result = calculateOutstanding(quarterly, [money(40000)], d('2026-12-01'));

    expect(result.nextDue).toBeNull();
    expect(result.daysUntilNextDue).toBeNull();
  });
});

describe('outstanding — edge cases', () => {
  it('treats an overpayment as credit, never negative debt', () => {
    const result = calculateOutstanding(quarterly, [money(15000)], d('2026-01-15'));

    expect(result.outstanding.toFixed(2)).toBe('0.00');
    expect(result.credit.toFixed(2)).toBe('5000.00');
    expect(result.isOverdue).toBe(false);
  });

  it('expects nothing before the contract starts', () => {
    const result = calculateOutstanding(quarterly, [], d('2025-12-31'));

    expect(result.expectedToDate.toFixed(2)).toBe('0.00');
    expect(result.installmentsDue).toBe(0);
    expect(result.isOverdue).toBe(false);
  });

  it('counts the first installment as due on the start date itself', () => {
    const result = calculateOutstanding(quarterly, [], d('2026-01-01'));

    expect(result.installmentsDue).toBe(1);
    expect(result.outstanding.toFixed(2)).toBe('10000.00');
  });

  it('sums multiple part-payments against one installment', () => {
    const result = calculateOutstanding(quarterly, [money(4000), money(6000)], d('2026-01-15'));

    expect(result.receivedToDate.toFixed(2)).toBe('10000.00');
    expect(result.outstanding.toFixed(2)).toBe('0.00');
  });

  it('shows the whole term owing when nothing was ever paid', () => {
    const result = calculateOutstanding(quarterly, [], d('2026-12-31'));

    expect(result.outstanding.toFixed(2)).toBe('40000.00');
    expect(result.installmentsDue).toBe(4);
  });
});

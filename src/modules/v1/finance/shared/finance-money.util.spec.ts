import { Prisma } from '@prisma/client';
import {
  clampToZero,
  creditOf,
  isPositiveMoney,
  roundMoney,
  sumMoney,
  toMoneyString,
} from './finance-money.util';

describe('finance money utils', () => {
  describe('toMoneyString', () => {
    it('always renders exactly two decimals', () => {
      expect(toMoneyString(1000)).toBe('1000.00');
      expect(toMoneyString('2500.5')).toBe('2500.50');
      expect(toMoneyString(new Prisma.Decimal('0'))).toBe('0.00');
    });

    it('passes null through rather than emitting "null"', () => {
      expect(toMoneyString(null)).toBeNull();
      expect(toMoneyString(undefined)).toBeNull();
    });

    it('keeps precision a JS number would lose', () => {
      // 9007199254740993 is 2^53 + 1 — not representable as a double.
      expect(toMoneyString('9007199254740993.01')).toBe('9007199254740993.01');
    });
  });

  describe('sumMoney', () => {
    it('does not drift the way floating point addition does', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in plain JS.
      expect(sumMoney(['0.10', '0.20']).toFixed(2)).toBe('0.30');
    });

    it('sums a realistic set of rent payments exactly', () => {
      expect(sumMoney(['2000.00', '2000.00', '1999.99']).toFixed(2)).toBe('5999.99');
    });

    it('returns zero for an empty list', () => {
      expect(sumMoney([]).toFixed(2)).toBe('0.00');
    });
  });

  describe('roundMoney', () => {
    it('rounds half UP, not half-even', () => {
      // decimal.js defaults to ROUND_HALF_EVEN, which would give 2.34 here and
      // disagree with a hand-checked invoice.
      expect(roundMoney('2.345').toFixed(2)).toBe('2.35');
      expect(roundMoney('2.355').toFixed(2)).toBe('2.36');
    });
  });

  describe('outstanding vs credit', () => {
    it('never reports negative outstanding', () => {
      expect(clampToZero('-500.00').toFixed(2)).toBe('0.00');
      expect(clampToZero('500.00').toFixed(2)).toBe('500.00');
    });

    it('reports an overpayment as a positive credit instead', () => {
      expect(creditOf('-500.00').toFixed(2)).toBe('500.00');
      expect(creditOf('500.00').toFixed(2)).toBe('0.00');
    });

    it('keeps the two halves consistent — only one can be non-zero', () => {
      for (const balance of ['-500.00', '0.00', '500.00']) {
        const owed = clampToZero(balance);
        const credit = creditOf(balance);
        expect(owed.isZero() || credit.isZero()).toBe(true);
        expect(owed.minus(credit).toFixed(2)).toBe(new Prisma.Decimal(balance).toFixed(2));
      }
    });
  });

  describe('isPositiveMoney', () => {
    it('rejects zero and negatives', () => {
      expect(isPositiveMoney('0.01')).toBe(true);
      expect(isPositiveMoney('0')).toBe(false);
      expect(isPositiveMoney('-1')).toBe(false);
    });
  });
});

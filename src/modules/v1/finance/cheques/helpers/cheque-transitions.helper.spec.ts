import { ConflictException } from '@nestjs/common';
import { ChequeStatus } from '../../../../../common/enums/cheque-status.enum';
import { ChequeAction, assertTransition, canTransition } from './cheque-transitions.helper';

const ALL_STATUSES = Object.values(ChequeStatus);

/** action → the only statuses it may run from. Everything else must be refused. */
const EXPECTED: Record<ChequeAction, ChequeStatus[]> = {
  deposit: [ChequeStatus.HELD],
  clear: [ChequeStatus.DEPOSITED],
  bounce: [ChequeStatus.DEPOSITED, ChequeStatus.CLEARED],
  replace: [ChequeStatus.BOUNCED, ChequeStatus.HELD],
  cancel: [ChequeStatus.HELD],
  update: [ChequeStatus.HELD],
  delete: [ChequeStatus.HELD, ChequeStatus.CANCELLED],
};

describe('cheque transitions', () => {
  describe.each(Object.keys(EXPECTED) as ChequeAction[])('%s', (action) => {
    const allowed = EXPECTED[action];

    it.each(allowed)(`is allowed from %s`, (status) => {
      expect(canTransition(action, status)).toBe(true);
      expect(() => assertTransition(action, status)).not.toThrow();
    });

    const forbidden = ALL_STATUSES.filter((s) => !allowed.includes(s));

    it.each(forbidden)(`is refused from %s`, (status) => {
      expect(canTransition(action, status)).toBe(false);
      expect(() => assertTransition(action, status)).toThrow(ConflictException);
    });
  });

  describe('the specific cases the spec calls out', () => {
    it('cannot deposit a bounced cheque, with that exact wording', () => {
      expect(() => assertTransition('deposit', ChequeStatus.BOUNCED)).toThrow(
        'Cannot deposit a bounced cheque. Only a held cheque can be deposited.',
      );
    });

    it('cannot clear a bounced cheque', () => {
      expect(() => assertTransition('clear', ChequeStatus.BOUNCED)).toThrow(/Cannot clear a bounced cheque/);
    });

    it('cannot clear straight from HELD — the deposit step is mandatory', () => {
      expect(() => assertTransition('clear', ChequeStatus.HELD)).toThrow(/Only a deposited cheque/);
    });

    it('allows bouncing a cleared cheque (banks reverse after apparent clearance)', () => {
      expect(canTransition('bounce', ChequeStatus.CLEARED)).toBe(true);
    });

    it('cannot cancel after deposit', () => {
      expect(() => assertTransition('cancel', ChequeStatus.DEPOSITED)).toThrow(
        /Cannot cancel a deposited cheque/,
      );
    });

    it('cannot delete a cheque with financial history', () => {
      for (const status of [ChequeStatus.DEPOSITED, ChequeStatus.CLEARED, ChequeStatus.BOUNCED]) {
        expect(() => assertTransition('delete', status)).toThrow(ConflictException);
      }
    });

    it('cannot re-replace an already replaced cheque', () => {
      expect(() => assertTransition('replace', ChequeStatus.REPLACED)).toThrow(ConflictException);
    });

    it('messages name the statuses that would have worked', () => {
      expect(() => assertTransition('bounce', ChequeStatus.HELD)).toThrow(
        /Only a deposited or cleared cheque can be bounced/,
      );
    });

    it('phrases the edit action as "edited", not "edited"-mangled', () => {
      expect(() => assertTransition('update', ChequeStatus.CLEARED)).toThrow(
        'Cannot edit a cleared cheque. Only a held cheque can be edited.',
      );
    });
  });
});

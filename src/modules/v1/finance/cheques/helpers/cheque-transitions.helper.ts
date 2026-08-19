import { ConflictException } from '@nestjs/common';
import { ChequeStatus } from '../../../../../common/enums/cheque-status.enum';

/**
 * The cheque state machine, in one place so the rules can be read and tested
 * without going through the service.
 *
 *   HELD ──deposit──> DEPOSITED ──clear──> CLEARED
 *    │                    │                   │
 *    │                    └──────bounce───────┤
 *    │                                        │
 *    ├──cancel──> CANCELLED                   ▼
 *    │                                     BOUNCED
 *    └──replace──> REPLACED <──replace───────┘
 *
 * Two rulings that resolve ambiguities in spec §5.1/§5.2:
 *  - bounce is allowed from CLEARED as well as DEPOSITED. Banks do reverse a
 *    cheque days after it appears to have cleared, and §5.2 explicitly describes
 *    voiding the Payment when that happens. Bouncing a CLEARED cheque
 *    soft-deletes its Payment in the same transaction.
 *  - clear is allowed ONLY from DEPOSITED. A cheque cannot skip the deposit step,
 *    which keeps the audit trail complete.
 *
 * CLEARED, BOUNCED, REPLACED and CANCELLED are otherwise terminal.
 */
export type ChequeAction = 'deposit' | 'clear' | 'bounce' | 'replace' | 'cancel' | 'update' | 'delete';

const ALLOWED_FROM: Record<ChequeAction, ChequeStatus[]> = {
  deposit: [ChequeStatus.HELD],
  clear: [ChequeStatus.DEPOSITED],
  bounce: [ChequeStatus.DEPOSITED, ChequeStatus.CLEARED],
  // A bounced cheque is the usual case; replacing a HELD cheque covers the
  // tenant swapping it by mutual agreement before it was ever banked.
  replace: [ChequeStatus.BOUNCED, ChequeStatus.HELD],
  cancel: [ChequeStatus.HELD],
  // Metadata (bank, number, dates, notes) is only editable before the cheque has
  // been to the bank — after that the record has to match what the bank saw.
  update: [ChequeStatus.HELD],
  // Never remove a cheque that has financial history downstream (spec §5.1).
  delete: [ChequeStatus.HELD, ChequeStatus.CANCELLED],
};

/**
 * Human phrasing for the 409 messages, so they read as an explanation rather than
 * an enum dump. Both forms are spelled out rather than derived — appending "ed"
 * gives "bounceed"/"replaceed"/"deleteed" for the verbs ending in e.
 */
const ACTION_PHRASING: Record<ChequeAction, { verb: string; done: string }> = {
  deposit: { verb: 'deposit', done: 'deposited' },
  clear: { verb: 'clear', done: 'cleared' },
  bounce: { verb: 'bounce', done: 'bounced' },
  replace: { verb: 'replace', done: 'replaced' },
  cancel: { verb: 'cancel', done: 'cancelled' },
  update: { verb: 'edit', done: 'edited' },
  delete: { verb: 'delete', done: 'deleted' },
};

const STATUS_LABEL: Record<ChequeStatus, string> = {
  [ChequeStatus.HELD]: 'held',
  [ChequeStatus.DEPOSITED]: 'deposited',
  [ChequeStatus.CLEARED]: 'cleared',
  [ChequeStatus.BOUNCED]: 'bounced',
  [ChequeStatus.REPLACED]: 'replaced',
  [ChequeStatus.CANCELLED]: 'cancelled',
};

export function canTransition(action: ChequeAction, from: ChequeStatus): boolean {
  return ALLOWED_FROM[action].includes(from);
}

/**
 * Throws 409 with a message that says what was attempted, what state blocked it,
 * and which states would have worked — spec §5.1 requires illegal transitions to
 * be self-explanatory ("Cannot deposit a bounced cheque").
 */
export function assertTransition(action: ChequeAction, from: ChequeStatus): void {
  if (canTransition(action, from)) return;

  const allowed = ALLOWED_FROM[action].map((status) => STATUS_LABEL[status]).join(' or ');
  const { verb, done } = ACTION_PHRASING[action];

  throw new ConflictException(
    `Cannot ${verb} a ${STATUS_LABEL[from]} cheque. Only a ${allowed} cheque can be ${done}.`,
  );
}

export enum ChequeStatus {
  /** Received from the tenant but not yet taken to the bank. */
  HELD = 'HELD',
  /** Deposited at the bank, awaiting clearance. */
  DEPOSITED = 'DEPOSITED',
  /** Cleared successfully — a linked Payment exists. */
  CLEARED = 'CLEARED',
  /** Returned by the bank. Never has a cleared Payment. */
  BOUNCED = 'BOUNCED',
  /** Superseded by another cheque — see replacedByChequeId. */
  REPLACED = 'REPLACED',
  /** Voided by mutual agreement before deposit. */
  CANCELLED = 'CANCELLED',
}

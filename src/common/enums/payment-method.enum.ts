/**
 * The four modes the client actually uses are CHEQUE, BANK_TRANSFER, CASH
 * (deposited cash) and COURT_TRANSFER. CARD/ONLINE/OTHER are retained because
 * expenses share this enum and pay vendors by other means.
 */
export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  CARD = 'CARD',
  ONLINE = 'ONLINE',
  /** Rent paid in through the rent dispute committee / courts rather than to the landlord. */
  COURT_TRANSFER = 'COURT_TRANSFER',
  OTHER = 'OTHER',
}

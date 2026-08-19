export enum PaymentKind {
  RENT = 'RENT',
  SECURITY_DEPOSIT = 'SECURITY_DEPOSIT',
  LATE_FEE = 'LATE_FEE',
  /** Money going OUT — a deposit returned or an overpayment refunded. Stored as a
   * positive amount; reports subtract it rather than the sign being carried here. */
  REFUND = 'REFUND',
  OTHER = 'OTHER',
}

/**
 * Where an expense came from. Finance owns ALL expenses; other modules originate
 * some of them and are identified here (the Option C boundary in the spec).
 *
 * Only GENERAL is reachable through the UI today. The rest are the extension
 * point: when Services is built it will create rows with WORK_ORDER plus a
 * sourceRefId pointing at its own record, via a shared Finance service method
 * rather than by writing to the table directly.
 */
export enum ExpenseSourceType {
  GENERAL = 'GENERAL',
  WORK_ORDER = 'WORK_ORDER',
  UTILITY_BILL = 'UTILITY_BILL',
  IMPORT = 'IMPORT',
}

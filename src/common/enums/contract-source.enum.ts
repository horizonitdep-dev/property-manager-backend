/**
 * Where a Contract came from.
 *
 * DMT_TAWTHEEQ contracts are the government-registered ones and are treated as
 * authoritative: a Green Contract is refused for any unit that already has a
 * contract on file, regardless of that contract's source or status.
 */
export enum ContractSource {
  DMT_TAWTHEEQ = 'DMT_TAWTHEEQ',
  R6_GREEN_CONTRACT = 'R6_GREEN_CONTRACT',
  MANUAL = 'MANUAL',
  CSV_IMPORT = 'CSV_IMPORT',
}

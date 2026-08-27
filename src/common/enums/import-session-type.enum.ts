/**
 * Which importer produced an ImportSession.
 *
 * Each import path checks this before acting on a session, so the Green Contract
 * endpoints cannot be handed a DMT session (or vice versa) and silently apply the
 * wrong normalization to it.
 */
export enum ImportSessionType {
  DMT_TAWTHEEQ = 'DMT_TAWTHEEQ',
  R6_GREEN_CONTRACT = 'R6_GREEN_CONTRACT',
  CSV_EXCEL_BUILDINGS = 'CSV_EXCEL_BUILDINGS',
  CSV_EXCEL_PROPERTIES = 'CSV_EXCEL_PROPERTIES',
  CSV_EXCEL_TENANTS = 'CSV_EXCEL_TENANTS',
  CSV_EXCEL_CONTRACTS = 'CSV_EXCEL_CONTRACTS',
}

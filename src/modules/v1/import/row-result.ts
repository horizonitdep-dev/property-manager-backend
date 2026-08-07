export interface RowResult {
  /** 1-based, matches the row number the user sees in their spreadsheet. */
  rowNumber: number;
  data: Record<string, unknown>;
  status: 'VALID' | 'ERROR';
  errors: { field: string; message: string }[];
  /** Non-blocking — the row still commits. e.g. a COMPANY tenant imported without
   * trade licence expiry / authorized person details (see IMPORT_OPTIONAL_COMPANY_FIELDS). */
  warnings?: { field: string; message: string }[];
  /** e.g. { buildingId, tenantId, propertyId } — filled in once a reference resolves. */
  resolvedRefs?: Record<string, string>;
}

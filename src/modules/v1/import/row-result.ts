export interface RowResult {
  /** 1-based, matches the row number the user sees in their spreadsheet. */
  rowNumber: number;
  data: Record<string, unknown>;
  status: 'VALID' | 'ERROR';
  errors: { field: string; message: string }[];
  /** e.g. { buildingId, tenantId, propertyId } — filled in once a reference resolves. */
  resolvedRefs?: Record<string, string>;
}

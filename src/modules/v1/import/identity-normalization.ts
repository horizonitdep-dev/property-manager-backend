/**
 * Canonical forms used to decide whether two records are the same thing.
 *
 * These are MATCHING keys only — nothing here changes what is stored. The same
 * identity gets written differently by different sources, and comparing the raw
 * strings creates duplicates:
 *
 *   Emirates ID     "784-1990-3780179-4"  vs  "784199037801794"
 *   Trade licence   "CN-1234567"          vs  "CN:1234567"
 *   Unit number     "Show Room 4"         vs  "show room  4"
 */

/** Digits only. A UAE Emirates ID is 15 digits however it is punctuated. */
export function normalizeEmiratesId(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Letters and digits only, upper-cased — drops CN-/CN: prefix punctuation. */
export function normalizeTradeLicense(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Collapses whitespace and upper-cases, so "Show Room  4" == "SHOW ROOM 4". */
export function normalizeUnitNumber(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** The weakest identity, used only when no number is available. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** "R6" is a component of "MZW16-R6". Used to match a plot-only code against a
 * composite Plot+Sector one. */
export function buildingCodeComponents(code: string | null | undefined): string[] {
  return (code ?? '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

export interface TenantIdentityFields {
  emiratesIdNumber?: string | null;
  tradeLicenseNumber?: string | null;
  nameEn?: string | null;
}

/** One comparable key per tenant: trade licence, then Emirates ID, then name. */
export function tenantMatchKey(tenant: TenantIdentityFields): string {
  const trade = normalizeTradeLicense(tenant.tradeLicenseNumber);
  if (trade) return `trade:${trade}`;

  const eid = normalizeEmiratesId(tenant.emiratesIdNumber);
  if (eid) return `eid:${eid}`;

  return `name:${normalizeName(tenant.nameEn)}`;
}

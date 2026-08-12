export type ExtractionFieldStatus = 'ok' | 'derived' | 'missing' | 'guessed';

export interface ExtractionFlag {
  field: string;
  status: ExtractionFieldStatus;
  note?: string;
}

/** Candidate values in the same human-label form the CSV/XLSX importers already
 * accept (e.g. unitType: 'Warehouse', not the raw enum 'WAREHOUSE') — the PDF
 * path feeds these through the exact same DTO validation as CSV import. */
export interface NormalizedBuildingCandidate {
  propertyRegistrationNo: string;
  /** Sector + Plot No. (e.g. "M17-108") when both are on the PDF — the identifier
   * actually used to name/dedupe the building. Falls back to the property
   * registration number when either is missing (see the 'code' flag for which). */
  code: string;
  name: string;
  address: string;
  city: string;
  flags: ExtractionFlag[];
}

export interface NormalizedUnitCandidate {
  unitNumber: string;
  unitType: string;
  sizeSqm?: number;
  flags: ExtractionFlag[];
}

export interface NormalizedTenantCandidate {
  tenantType: 'Individual' | 'Company';
  nameEn: string;
  nameAr?: string;
  phone?: string;
  email?: string;
  tradeLicenseNumber?: string;
  /** Individual-only identity fields, present when the PDF printed them
   * (typical of residential contracts, often absent on commercial ones). The
   * matching expiry dates are never on a DMT contract, so they are always
   * blank — see PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS. */
  emiratesIdNumber?: string;
  passportNumber?: string;
  nationality?: string;
  flags: ExtractionFlag[];
}

export interface NormalizedContractCandidate {
  contractNumber: string;
  startDate: string;
  endDate: string;
  annualRent: number;
  monthlyRent: number;
  paymentFrequency: string;
  numberOfCheques?: number;
  securityDeposit?: number;
  notes?: string;
  flags: ExtractionFlag[];
}

export interface ExtractedContractResult {
  sourceFileName: string;
  building: NormalizedBuildingCandidate;
  /** Always ≥1. Multi-unit contracts list every unit here; the contract itself
   * links only the first (§3 — "the Contract references the FIRST unit and
   * lists the others in notes, mirrors the existing convention"). */
  units: NormalizedUnitCandidate[];
  tenant: NormalizedTenantCandidate;
  contract: NormalizedContractCandidate;
  usage: { inputTokens: number; outputTokens: number };
  /** The raw, schema-validated model output — kept on the ImportSession for auditing (§5). */
  rawExtraction: unknown;
}

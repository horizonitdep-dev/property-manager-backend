import { ExtractionFlag } from './pdf-extraction-result';

/**
 * Normalized Green Contract candidate — the shape the import service feeds into
 * the module DTOs.
 *
 * Values are in the same human-label form the CSV/XLSX importers accept (e.g.
 * tenantType 'Individual', paymentFrequency 'Cheques'), so the Green path reuses
 * the exact enum-label mapping and DTO validation every other importer uses.
 *
 * ExtractionFlag is imported from the DMT result module rather than redeclared:
 * it is a shared preview vocabulary (ok / derived / missing / guessed), not DMT
 * logic, and the frontend renders both paths' flags identically.
 */

export interface NormalizedGreenBuilding {
  code: string;
  name: string;
  flags: ExtractionFlag[];
}

export interface NormalizedGreenUnit {
  unitNumber: string;
  flags: ExtractionFlag[];
}

export interface NormalizedGreenTenant {
  tenantType: 'Individual' | 'Company';
  nameEn: string;
  nameAr?: string;
  phone?: string;
  emiratesIdNumber?: string;
  tradeLicenseNumber?: string;
  authorizedPersonNameEn?: string;
  authorizedPersonNameAr?: string;
  flags: ExtractionFlag[];
}

export interface NormalizedGreenContract {
  /** Always GC-{buildingCode}-{unitNumber}; flagged `derived` in the preview. */
  contractNumber: string;
  startDate: string;
  endDate: string;
  annualRent: number;
  monthlyRent: number;
  paymentFrequency: string;
  numberOfCheques?: number;
  notes?: string;
  flags: ExtractionFlag[];
}

export interface ExtractedGreenContractResult {
  sourceFileName: string;
  building: NormalizedGreenBuilding;
  unit: NormalizedGreenUnit;
  tenant: NormalizedGreenTenant;
  contract: NormalizedGreenContract;
  usage: { inputTokens: number; outputTokens: number };
  /** The raw, schema-validated model output — kept on the ImportSession for auditing (§5.6). */
  rawExtraction: unknown;
}

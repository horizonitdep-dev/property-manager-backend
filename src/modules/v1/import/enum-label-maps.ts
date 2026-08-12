import { BuildingType } from '../../../common/enums/building-type.enum';
import { ConstructionStatus } from '../../../common/enums/construction-status.enum';
import { UnitType } from '../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../common/enums/property-status.enum';
import { TenantType } from '../../../common/enums/tenant-type.enum';
import { TenantStatus } from '../../../common/enums/tenant-status.enum';
import { PaymentFrequency } from '../../../common/enums/payment-frequency.enum';
import { ContractStatus } from '../../../common/enums/contract-status.enum';

/**
 * Single source of truth for every human-label → enum mapping used across import
 * paths (CSV/XLSX importers and the PDF extraction/resolution path) — reused
 * rather than each importer declaring its own copy, so a label only ever needs
 * updating in one place.
 */

export const BUILDING_TYPE_LABELS: Record<string, BuildingType> = {
  residential: BuildingType.RESIDENTIAL,
  commercial: BuildingType.COMMERCIAL,
  'mixed-use': BuildingType.MIXED_USE,
  'mixed use': BuildingType.MIXED_USE,
};

export const CONSTRUCTION_STATUS_LABELS: Record<string, ConstructionStatus> = {
  complete: ConstructionStatus.COMPLETE,
  'under construction': ConstructionStatus.UNDER_CONSTRUCTION,
};

export const UNIT_TYPE_LABELS: Record<string, UnitType> = {
  apartment: UnitType.APARTMENT,
  studio: UnitType.STUDIO,
  shop: UnitType.SHOP,
  office: UnitType.OFFICE,
  'roof unit': UnitType.ROOF_UNIT,
  warehouse: UnitType.WAREHOUSE,
  villa: UnitType.VILLA,
};

export const PROPERTY_STATUS_LABELS: Record<string, PropertyStatus> = {
  vacant: PropertyStatus.VACANT,
  occupied: PropertyStatus.OCCUPIED,
  'under maintenance': PropertyStatus.UNDER_MAINTENANCE,
  reserved: PropertyStatus.RESERVED,
};

export const TENANT_TYPE_LABELS: Record<string, TenantType> = {
  individual: TenantType.INDIVIDUAL,
  company: TenantType.COMPANY,
};

export const TENANT_STATUS_LABELS: Record<string, TenantStatus> = {
  active: TenantStatus.ACTIVE,
  former: TenantStatus.FORMER,
};

export const PAYMENT_FREQUENCY_LABELS: Record<string, PaymentFrequency> = {
  monthly: PaymentFrequency.MONTHLY,
  quarterly: PaymentFrequency.QUARTERLY,
  'bi-annual': PaymentFrequency.BI_ANNUAL,
  'bi annual': PaymentFrequency.BI_ANNUAL,
  annual: PaymentFrequency.ANNUAL,
  'single payment': PaymentFrequency.SINGLE_PAYMENT,
  cheques: PaymentFrequency.CHEQUES,
};

// Only these two are settable via import — EXPIRING_SOON/EXPIRED are computed, never
// stored, and TERMINATED is only ever reached via the terminate endpoint (mirrors
// CreateContractDto's own CREATABLE_STATUSES restriction).
export const CONTRACT_IMPORT_STATUS_LABELS: Record<string, ContractStatus> = {
  draft: ContractStatus.DRAFT,
  active: ContractStatus.ACTIVE,
};

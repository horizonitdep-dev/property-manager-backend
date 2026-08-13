import {
  IMPORT_OPTIONAL_COMPANY_FIELDS,
  getMissingTenantTypeFields,
} from '../tenants/validators/tenant-type-fields.validator';
import { TenantType } from '../../../common/enums/tenant-type.enum';

/**
 * INDIVIDUAL fields the PDF import path is allowed to leave blank, mirroring what
 * IMPORT_OPTIONAL_COMPANY_FIELDS already does for COMPANY tenants.
 *
 * A DMT tenancy contract never prints an Emirates ID or passport EXPIRY date —
 * those live on the ID document itself, not the contract — so requiring them
 * would fail every individual tenant, always. emiratesIdNumber and
 * passportNumber ARE printed on residential contracts (and are extracted when
 * present, see ExtractedTenantDto), but commercial lets frequently omit them,
 * so they're exempt too: the row imports and the missing value is surfaced as a
 * preview flag rather than wedging the whole batch.
 *
 * This deliberately lives in the import feature rather than alongside the
 * COMPANY list, because it is passed through TenantsService.create()'s existing
 * `exemptFromRequiredCheck` parameter — no tenant-side file needs to change.
 */
export const PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS = [
  'emiratesIdNumber',
  'emiratesIdExpiry',
  'passportNumber',
  'passportExpiry',
] as const;

/** The exemption list TenantsService.create() should be given for this tenant. */
export function exemptFieldsForTenantType(tenantType: unknown): readonly string[] {
  return tenantType === TenantType.INDIVIDUAL
    ? PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS
    : IMPORT_OPTIONAL_COMPANY_FIELDS;
}

/**
 * The tenant-type required-field check as TenantsService.create() will actually
 * apply it at commit time, so the preview can report the same answer.
 *
 * The preview can't rely on CreateTenantDto alone here: its identity fields pair
 * @RequiredForTenantType() with @ValidateIf(o => isProvided(...)), and a false
 * ValidateIf skips EVERY validator on that property — including the required
 * check. So an ABSENT field silently passes DTO validation while the service's
 * own check still rejects it, which is exactly how a row could preview as VALID
 * and then 409 at commit. Running this alongside the DTO closes that gap.
 */
export function missingRequiredTenantFields(data: Record<string, unknown>): string[] {
  const exempt = exemptFieldsForTenantType(data.tenantType);
  return getMissingTenantTypeFields(data as { tenantType?: string | null }).filter(
    (field) => !exempt.includes(field),
  );
}

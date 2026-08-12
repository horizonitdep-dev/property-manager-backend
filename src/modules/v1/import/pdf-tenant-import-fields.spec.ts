import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantDto } from '../tenants/dtos/create-tenant.dto';
import { getMissingTenantTypeFields } from '../tenants/validators/tenant-type-fields.validator';
import {
  PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS,
  exemptFieldsForTenantType,
  missingRequiredTenantFields,
} from './pdf-tenant-import-fields';

/** A tenant exactly as the PDF path builds it: names/phone from the contract,
 * no ID expiry dates (a DMT contract never prints them). */
const individualFromPdf = {
  tenantType: 'INDIVIDUAL',
  nameEn: 'Wali Ullah Yaqoob Khan',
  phone: '+971501234567',
  emiratesIdNumber: '784-1990-1234567-1',
};

describe('pdf tenant import fields', () => {
  it('picks the individual exemptions for an individual and the company ones otherwise', () => {
    expect(exemptFieldsForTenantType('INDIVIDUAL')).toBe(PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS);
    expect(exemptFieldsForTenantType('COMPANY')).not.toBe(PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS);
  });

  it('does not block an individual over ID fields a DMT contract never carries', () => {
    // Regression: previously the PDF path passed the COMPANY exemption list for
    // every tenant, so an individual hit TenantsService's required-field check
    // for all four ID fields and 409'd the whole batch at commit.
    expect(missingRequiredTenantFields(individualFromPdf)).toEqual([]);
  });

  it('still blocks a company missing its trade licence number', () => {
    // tradeLicenseNumber is deliberately NOT exempt — the company identity anchor.
    expect(missingRequiredTenantFields({ tenantType: 'COMPANY', nameEn: 'Al Noor LLC' })).toEqual([
      'tradeLicenseNumber',
    ]);
  });

  it('agrees with the check TenantsService.create() actually applies at commit', () => {
    // The service computes exactly this: required-for-type minus the exemptions
    // it was handed. If these ever diverge, preview and commit disagree again.
    const exempt = exemptFieldsForTenantType(individualFromPdf.tenantType);
    const serviceView = getMissingTenantTypeFields(individualFromPdf).filter(
      (field) => !exempt.includes(field),
    );

    expect(missingRequiredTenantFields(individualFromPdf)).toEqual(serviceView);
  });

  it('catches an absent required field that CreateTenantDto alone lets through', async () => {
    // Documents the gap this function exists to close: on the identity fields
    // @ValidateIf(o => isProvided(...)) sits alongside @RequiredForTenantType(),
    // and a false ValidateIf skips EVERY validator on the property — including
    // the required check. So the DTO approves an individual with no ID at all.
    const noIdAtAll = { tenantType: 'INDIVIDUAL', nameEn: 'Test Person', phone: '+971501234567' };

    const violations = await validate(plainToInstance(CreateTenantDto, noIdAtAll), {
      whitelist: true,
    });
    expect(violations.map((v) => v.property)).not.toContain('emiratesIdNumber');

    // ...which is fine only because the import path deliberately exempts them.
    // A field outside the exemption list must still be reported.
    expect(missingRequiredTenantFields({ tenantType: 'COMPANY', nameEn: 'X' })).toContain(
      'tradeLicenseNumber',
    );
  });
});

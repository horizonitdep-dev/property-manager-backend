import { Test, TestingModule } from '@nestjs/testing';
import { TenantsImporter } from './tenants.importer';
import { PrismaService } from '../../../../../database/prisma.service';
import { TenantsService } from '../../../tenants/tenants.service';
import { IMPORT_OPTIONAL_COMPANY_FIELDS } from '../../../tenants/validators/tenant-type-fields.validator';
import { ParsedRow } from '../file-parser.service';

function row(rowNumber: number, values: Record<string, string | null>): ParsedRow {
  return { rowNumber, rawValues: values };
}

function validIndividualValues(): Record<string, string | null> {
  return {
    'tenant type': 'Individual',
    'full name (english)': 'Ahmed Al Mansoori',
    'full name (arabic)': 'أحمد المنصوري',
    phone: '+971501234567',
    'alternate phone': null,
    email: 'tenant@example.com',
    nationality: 'UAE',
    'emirates id number': '784-1990-1234567-1',
    'emirates id expiry': '2027-01-31',
    'passport number': 'P1234567',
    'passport expiry': '2029-06-30',
    'trade license number': null,
    'trade license expiry': null,
    'authorized person (english)': null,
    'authorized person (arabic)': null,
    'authorized person occupation': null,
    'authorized person phone': null,
    status: 'Active',
    notes: null,
  };
}

function validCompanyValues(): Record<string, string | null> {
  return {
    ...validIndividualValues(),
    'tenant type': 'Company',
    'emirates id number': null,
    'emirates id expiry': null,
    'passport number': null,
    'passport expiry': null,
    'trade license number': 'CN-1234567',
    'trade license expiry': '2026-12-31',
    'authorized person (english)': 'Khalid Al Suwaidi',
    'authorized person occupation': 'General Manager',
  };
}

describe('TenantsImporter', () => {
  let importer: TenantsImporter;
  let prisma: { $transaction: jest.Mock };
  let tenantsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)) };
    tenantsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsImporter,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantsService, useValue: tenantsService },
      ],
    }).compile();

    importer = module.get(TenantsImporter);
  });

  it('marks a fully valid Individual row VALID, preserving Arabic text', async () => {
    const [result] = await importer.validateRows([row(2, validIndividualValues())]);

    expect(result.status).toBe('VALID');
    expect((result.data as { nameAr: string }).nameAr).toBe('أحمد المنصوري');
  });

  it('marks a fully valid Company row VALID', async () => {
    const [result] = await importer.validateRows([row(2, validCompanyValues())]);

    expect(result.status).toBe('VALID');
  });

  it('flags an Individual missing Emirates ID / passport fields', async () => {
    const values = validIndividualValues();
    values['emirates id number'] = null;
    values['emirates id expiry'] = null;
    values['passport number'] = null;
    values['passport expiry'] = null;

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.status).toBe('ERROR');
    const fields = result.errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'emiratesIdNumber',
        'emiratesIdExpiry',
        'passportNumber',
        'passportExpiry',
      ]),
    );
  });

  it('flags a Company missing trade license number (not import-relaxable) as an error', async () => {
    const values = validCompanyValues();
    values['trade license number'] = null;
    values['trade license expiry'] = null;
    values['authorized person (english)'] = null;
    values['authorized person occupation'] = null;

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.status).toBe('ERROR');
    expect(result.errors.map((e) => e.field)).toEqual(['tradeLicenseNumber']);
  });

  it('treats a Company missing trade license expiry / authorized person details as VALID with a warning', async () => {
    const values = validCompanyValues();
    values['trade license expiry'] = null;
    values['authorized person (english)'] = null;
    values['authorized person occupation'] = null;

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.status).toBe('VALID');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0].message).toContain('Trade License Expiry');
    expect(result.warnings?.[0].message).toContain('Authorized Person (English)');
    expect(result.warnings?.[0].message).toContain('Authorized Person Occupation');
  });

  it('does not warn on a fully complete Company row', async () => {
    const [result] = await importer.validateRows([row(2, validCompanyValues())]);

    expect(result.status).toBe('VALID');
    expect(result.warnings).toBeUndefined();
  });

  it('never relaxes Individual-required fields, even though they overlap no Company field names', async () => {
    const values = validIndividualValues();
    values['emirates id number'] = null;
    values['emirates id expiry'] = null;
    values['passport number'] = null;
    values['passport expiry'] = null;

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.status).toBe('ERROR');
    expect(result.warnings).toBeUndefined();
  });

  it('accepts DD/MM/YYYY and normalizes it to ISO', async () => {
    const values = validIndividualValues();
    values['emirates id expiry'] = '31/01/2027';

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.status).toBe('VALID');
    expect((result.data as { emiratesIdExpiry: string }).emiratesIdExpiry).toBe('2027-01-31');
  });

  it('rejects an unparsable date with a clear error', async () => {
    const values = validIndividualValues();
    values['emirates id expiry'] = 'not-a-date';

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.errors.some((e) => e.field === 'Emirates ID Expiry')).toBe(true);
  });

  it('rejects an unrecognized Tenant Type label', async () => {
    const values = validIndividualValues();
    values['tenant type'] = 'Bogus';

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.errors.some((e) => e.field === 'Tenant Type')).toBe(true);
  });

  describe('commitRows', () => {
    it('inserts only valid rows via the real TenantsService.create path', async () => {
      tenantsService.create.mockResolvedValue({ id: 'new-tenant' });

      const inserted = await importer.commitRows(
        [{ rowNumber: 2, data: { nameEn: 'Ahmed' }, status: 'VALID', errors: [] }],
        'user-1',
      );

      expect(inserted).toBe(1);
      expect(tenantsService.create).toHaveBeenCalledWith(
        { nameEn: 'Ahmed' },
        'user-1',
        prisma,
        IMPORT_OPTIONAL_COMPANY_FIELDS,
      );
    });
  });
});

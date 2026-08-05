import { Test, TestingModule } from '@nestjs/testing';
import { ContractsImporter } from './contracts.importer';
import { PrismaService } from '../../../../../database/prisma.service';
import { ContractsService } from '../../../contracts/contracts.service';
import { ParsedRow } from '../file-parser.service';

function row(rowNumber: number, values: Record<string, string | null>): ParsedRow {
  return { rowNumber, rawValues: values };
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const BUILDING_ID = '22222222-2222-4222-8222-222222222222';
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';

function validRowValues(): Record<string, string | null> {
  return {
    'contract number': 'C-2026-001',
    'tenant name (english)': 'Ahmed Al Mansoori',
    'building code': 'R6',
    'unit number': '101',
    'start date': '2026-01-01',
    'end date': '2026-12-31',
    'annual rent': '24000',
    'monthly rent': '2000',
    'payment frequency': 'Monthly',
    'number of cheques': null,
    'security deposit': '2000',
    status: 'Active',
    notes: null,
  };
}

describe('ContractsImporter', () => {
  let importer: ContractsImporter;
  let prisma: {
    tenant: { findMany: jest.Mock };
    building: { findFirst: jest.Mock };
    property: { findFirst: jest.Mock };
    contract: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let contractsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tenant: { findMany: jest.fn() },
      building: { findFirst: jest.fn() },
      property: { findFirst: jest.fn() },
      contract: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    contractsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsImporter,
        { provide: PrismaService, useValue: prisma },
        { provide: ContractsService, useValue: contractsService },
      ],
    }).compile();

    importer = module.get(ContractsImporter);

    prisma.tenant.findMany.mockResolvedValue([{ id: TENANT_ID }]);
    prisma.building.findFirst.mockResolvedValue({ id: BUILDING_ID, code: 'R6', deletedAt: null });
    prisma.property.findFirst.mockResolvedValue({ id: PROPERTY_ID, deletedAt: null });
    prisma.contract.findFirst.mockResolvedValue(null); // no overlap by default
  });

  it('resolves tenant + property and marks a fully valid ACTIVE row VALID', async () => {
    const [result] = await importer.validateRows([row(2, validRowValues())]);

    expect(result.status).toBe('VALID');
    expect(result.resolvedRefs).toEqual({ tenantId: TENANT_ID, propertyId: PROPERTY_ID });
  });

  it('flags a tenant name that matches no one', async () => {
    prisma.tenant.findMany.mockResolvedValue([]);

    const [result] = await importer.validateRows([row(2, validRowValues())]);

    expect(result.errors.some((e) => e.message.includes('Tenant not found'))).toBe(true);
  });

  it('flags an ambiguous tenant name matching multiple records', async () => {
    prisma.tenant.findMany.mockResolvedValue([{ id: TENANT_ID }, { id: 'other-id' }]);

    const [result] = await importer.validateRows([row(2, validRowValues())]);

    expect(result.errors.some((e) => e.message.includes('Ambiguous tenant') && e.message.includes('2 records'))).toBe(
      true,
    );
  });

  it('flags an unresolvable building code', async () => {
    prisma.building.findFirst.mockResolvedValue(null);

    const [result] = await importer.validateRows([row(2, validRowValues())]);

    expect(result.errors.some((e) => e.message.includes("Building not found: 'R6'"))).toBe(true);
  });

  it('flags a unit number not found in the resolved building', async () => {
    prisma.property.findFirst.mockResolvedValue(null);

    const [result] = await importer.validateRows([row(2, validRowValues())]);

    expect(result.errors.some((e) => e.message.includes('Property not found'))).toBe(true);
  });

  it('rejects endDate before startDate', async () => {
    const values = validRowValues();
    values['start date'] = '2026-12-31';
    values['end date'] = '2026-01-01';

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.errors.some((e) => e.field === 'endDate')).toBe(true);
  });

  it('requires numberOfCheques when Payment Frequency is Cheques', async () => {
    const values = validRowValues();
    values['payment frequency'] = 'Cheques';
    values['number of cheques'] = null;

    const [result] = await importer.validateRows([row(2, values)]);

    expect(result.errors.some((e) => e.field === 'numberOfCheques')).toBe(true);
  });

  it('flags an ACTIVE row that overlaps an existing active contract on the same property', async () => {
    prisma.contract.findFirst.mockResolvedValue({ contractNumber: 'EXISTING-001' });

    const [result] = await importer.validateRows([row(2, validRowValues())]);

    expect(
      result.errors.some((e) => e.message.includes('EXISTING-001') && e.message.includes('overlapping')),
    ).toBe(true);
  });

  it('does not overlap-check a DRAFT row', async () => {
    const values = validRowValues();
    values.status = 'Draft';

    await importer.validateRows([row(2, values)]);

    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
  });

  describe('commitRows', () => {
    it('inserts only valid rows via the real ContractsService.create path (fires occupancy side effect)', async () => {
      contractsService.create.mockResolvedValue({ id: 'new-contract' });

      const inserted = await importer.commitRows(
        [{ rowNumber: 2, data: { contractNumber: 'C-2026-001' }, status: 'VALID', errors: [] }],
        'user-1',
      );

      expect(inserted).toBe(1);
      expect(contractsService.create).toHaveBeenCalledWith(
        { contractNumber: 'C-2026-001' },
        'user-1',
        prisma,
      );
    });
  });
});

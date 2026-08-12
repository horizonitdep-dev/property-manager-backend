import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../database/prisma.service';
import { ExtractedContractResult } from '../pdf-extraction-result';
import { PdfResolutionService, PdfExtractionWithRowNumber } from './pdf-resolution.service';

const prisma = {
  building: { findFirst: jest.fn() },
  property: { findFirst: jest.fn() },
  tenant: { findFirst: jest.fn() },
  contract: { findFirst: jest.fn() },
};

/** An extraction result shaped like a real one, with everything valid by default
 * so a test only has to vary the field it's actually about. */
function extraction(overrides: {
  building?: Partial<ExtractedContractResult['building']>;
  tenant?: Partial<ExtractedContractResult['tenant']>;
  contract?: Partial<ExtractedContractResult['contract']>;
  unitNumber?: string;
} = {}): ExtractedContractResult {
  return {
    sourceFileName: 'contract.pdf',
    building: {
      propertyRegistrationNo: 'PRP816209',
      code: 'M17-108',
      name: 'Building M17-108',
      address: 'Mussafah, Abu Dhabi',
      city: 'Abu Dhabi',
      flags: [],
      ...overrides.building,
    },
    units: [{ unitNumber: overrides.unitNumber ?? 'Shop 7', unitType: 'Shop', sizeSqm: 40, flags: [] }],
    tenant: {
      tenantType: 'Individual',
      nameEn: 'Wali Ullah Yaqoob Khan',
      phone: '+971501234567',
      emiratesIdNumber: '784-1990-1234567-1',
      flags: [],
      ...overrides.tenant,
    },
    contract: {
      contractNumber: '202502622217',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      annualRent: 24000,
      monthlyRent: 2000,
      paymentFrequency: 'Cheques',
      numberOfCheques: 4,
      flags: [],
      ...overrides.contract,
    },
    usage: { inputTokens: 100, outputTokens: 50 },
    rawExtraction: {},
  };
}

function batch(...results: ExtractedContractResult[]): PdfExtractionWithRowNumber[] {
  return results.map((result, i) => ({ result, rowNumber: i + 1 }));
}

describe('PdfResolutionService', () => {
  let service: PdfResolutionService;

  beforeEach(async () => {
    jest.resetAllMocks();
    // Default: nothing already in the database.
    prisma.building.findFirst.mockResolvedValue(null);
    prisma.property.findFirst.mockResolvedValue(null);
    prisma.tenant.findFirst.mockResolvedValue(null);
    prisma.contract.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfResolutionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PdfResolutionService);
  });

  describe('contract status', () => {
    it('imports contracts as ACTIVE, not DRAFT', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].status).toBe('VALID');
      expect(result.contracts[0].data.status).toBe('ACTIVE');
    });
  });

  describe('in-batch dedupe', () => {
    it('collapses the same building across two PDFs into one candidate', async () => {
      const result = await service.resolveBatch(
        batch(
          extraction({ unitNumber: 'Shop 7', contract: { contractNumber: 'C-1' } }),
          extraction({ unitNumber: 'Shop 8', contract: { contractNumber: 'C-2' } }),
        ),
      );

      expect(result.buildings.rows).toHaveLength(1);
      expect(result.properties.rows).toHaveLength(2); // two distinct units
    });

    it('dedupes a building by code even when the registration numbers differ', async () => {
      // Regression: keying on propertyRegistrationNo produced two pending rows
      // sharing one code, and the second violated buildings_code_active_key
      // mid-transaction, rolling back the entire batch.
      const result = await service.resolveBatch(
        batch(
          extraction({ building: { propertyRegistrationNo: 'PRP111' }, contract: { contractNumber: 'C-1' } }),
          extraction({
            building: { propertyRegistrationNo: 'PRP222' },
            unitNumber: 'Shop 8',
            contract: { contractNumber: 'C-2' },
          }),
        ),
      );

      expect(result.buildings.rows).toHaveLength(1);
    });

    it('treats the same unit written in a different case as one property', async () => {
      const result = await service.resolveBatch(
        batch(
          extraction({ unitNumber: 'Shop 7', contract: { contractNumber: 'C-1' } }),
          extraction({ unitNumber: 'SHOP 7', contract: { contractNumber: 'C-2' } }),
        ),
      );

      expect(result.properties.rows).toHaveLength(1);
    });
  });

  describe('tenant identity', () => {
    it('matches one person across PDFs by Emirates ID despite a different name spelling', async () => {
      const result = await service.resolveBatch(
        batch(
          extraction({ tenant: { nameEn: 'Wali Ullah Yaqoob Khan' }, contract: { contractNumber: 'C-1' } }),
          extraction({
            tenant: { nameEn: 'WALI ULLAH Y. KHAN' },
            unitNumber: 'Shop 8',
            contract: { contractNumber: 'C-2' },
          }),
        ),
      );

      expect(result.tenants.rows).toHaveLength(1);
    });

    it('does not merge two different people who happen to share a name', async () => {
      const result = await service.resolveBatch(
        batch(
          extraction({
            tenant: { nameEn: 'Mohammed Ali', emiratesIdNumber: '784-1990-1111111-1' },
            contract: { contractNumber: 'C-1' },
          }),
          extraction({
            tenant: { nameEn: 'Mohammed Ali', emiratesIdNumber: '784-1985-2222222-2' },
            unitNumber: 'Shop 8',
            contract: { contractNumber: 'C-2' },
          }),
        ),
      );

      expect(result.tenants.rows).toHaveLength(2);
    });

    it('reuses an existing tenant instead of creating a duplicate', async () => {
      prisma.tenant.findFirst.mockResolvedValue({ id: 'existing-tenant-id' });

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.tenants.rows).toHaveLength(0);
      expect(result.contracts[0].resolvedRefs?.tenantId).toBe('existing-tenant-id');
    });

    it('looks an individual up by Emirates ID, not by name', async () => {
      await service.resolveBatch(batch(extraction()));

      expect(prisma.tenant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ emiratesIdNumber: '784-1990-1234567-1' }),
        }),
      );
    });

    it('falls back to the trade licence for a company', async () => {
      await service.resolveBatch(
        batch(
          extraction({
            tenant: {
              tenantType: 'Company',
              nameEn: 'Al Noor Trading LLC',
              tradeLicenseNumber: 'CN-1234567',
              emiratesIdNumber: undefined,
            },
          }),
        ),
      );

      expect(prisma.tenant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tradeLicenseNumber: 'CN-1234567' }),
        }),
      );
    });
  });

  describe('duplicate contracts', () => {
    it('rejects a contract number that already exists in the database', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'x', contractNumber: '202502622217' });

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].status).toBe('ERROR');
      expect(result.contracts[0].errors.some((e) => /already exists/.test(e.message))).toBe(true);
    });

    it('rejects the same contract number appearing twice in one batch', async () => {
      const result = await service.resolveBatch(
        batch(extraction(), extraction({ unitNumber: 'Shop 8' })),
      );

      expect(result.contracts[0].status).toBe('VALID');
      expect(result.contracts[1].status).toBe('ERROR');
      expect(result.contracts[1].errors.some((e) => /already used by row 1/.test(e.message))).toBe(true);
    });

    it('rejects a contract overlapping an existing active one on the same property', async () => {
      prisma.building.findFirst.mockResolvedValue({ id: 'building-id' });
      prisma.property.findFirst.mockResolvedValue({ id: 'property-id' });
      prisma.contract.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        // no contract-number match; only the overlap query finds something
        Promise.resolve(where.propertyId ? { id: 'y', contractNumber: 'C-EXISTING' } : null),
      );

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].status).toBe('ERROR');
      expect(result.contracts[0].errors.some((e) => /overlapping these dates/.test(e.message))).toBe(true);
    });
  });
});

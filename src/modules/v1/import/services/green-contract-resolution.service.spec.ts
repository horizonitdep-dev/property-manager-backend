import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../database/prisma.service';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { ExtractedGreenContractResult } from '../green-contract-extraction-result';
import {
  GreenContractResolutionService,
  GreenExtractionWithRowNumber,
} from './green-contract-resolution.service';

const BUILDING_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const EXISTING_CONTRACT_ID = '44444444-4444-4444-8444-444444444444';

const prisma = {
  building: { findFirst: jest.fn(), findMany: jest.fn() },
  property: { findFirst: jest.fn() },
  tenant: { findFirst: jest.fn(), findMany: jest.fn() },
  contract: { findFirst: jest.fn() },
};

function extraction(
  overrides: {
    building?: Partial<ExtractedGreenContractResult['building']>;
    unit?: Partial<ExtractedGreenContractResult['unit']>;
    tenant?: Partial<ExtractedGreenContractResult['tenant']>;
    contract?: Partial<ExtractedGreenContractResult['contract']>;
  } = {},
): ExtractedGreenContractResult {
  return {
    sourceFileName: 'green.pdf',
    building: { code: 'R6', name: 'R6', flags: [], ...overrides.building },
    unit: { unitNumber: '101', flags: [], ...overrides.unit },
    tenant: {
      tenantType: 'Individual',
      nameEn: 'Srikrishnan Suyambu Suyambu',
      phone: '+971567372527',
      emiratesIdNumber: '784-1990-3780179-4',
      flags: [],
      ...overrides.tenant,
    },
    contract: {
      contractNumber: 'GC-R6-101',
      startDate: '2026-07-08',
      endDate: '2027-07-07',
      annualRent: 47250,
      monthlyRent: 3938,
      paymentFrequency: 'Cheques',
      numberOfCheques: 4,
      notes: 'Imported from a Green Contract PDF.',
      flags: [],
      ...overrides.contract,
    },
    usage: { inputTokens: 2260, outputTokens: 282 },
    rawExtraction: {},
  };
}

function batch(...results: ExtractedGreenContractResult[]): GreenExtractionWithRowNumber[] {
  return results.map((result, i) => ({ result, rowNumber: i + 1 }));
}

describe('GreenContractResolutionService', () => {
  let service: GreenContractResolutionService;

  beforeEach(async () => {
    jest.resetAllMocks();
    // Default: an empty database.
    prisma.building.findFirst.mockResolvedValue(null);
    prisma.building.findMany.mockResolvedValue([]);
    prisma.property.findFirst.mockResolvedValue(null);
    prisma.tenant.findFirst.mockResolvedValue(null);
    prisma.tenant.findMany.mockResolvedValue([]);
    prisma.contract.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [GreenContractResolutionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(GreenContractResolutionService);
  });

  describe('duplicate rule (spec §6) — the critical matrix', () => {
    /** Puts an existing contract on the target property. */
    function unitHasContract(status: ContractStatus) {
      prisma.building.findFirst.mockResolvedValue({ id: BUILDING_ID });
      prisma.property.findFirst.mockResolvedValue({ id: PROPERTY_ID });
      prisma.contract.findFirst.mockResolvedValue({
        id: EXISTING_CONTRACT_ID,
        contractNumber: '476810',
        status,
      });
    }

    it.each([
      [ContractStatus.ACTIVE],
      [ContractStatus.EXPIRED],
      [ContractStatus.DRAFT],
      [ContractStatus.TERMINATED],
    ])('blocks the row when the unit already has a %s contract', async (status) => {
      unitHasContract(status);

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].status).toBe('ERROR');
      expect(result.contracts[0].errors.some((e) => /already has a contract/.test(e.message))).toBe(true);
    });

    it('carries the existing contract id so the UI can link to it', async () => {
      unitHasContract(ContractStatus.ACTIVE);

      const result = await service.resolveBatch(batch(extraction()));
      const block = JSON.parse(result.contracts[0].resolvedRefs!.duplicateBlock);

      expect(block).toMatchObject({
        code: 'PROPERTY_HAS_EXISTING_CONTRACT',
        existingContractId: EXISTING_CONTRACT_ID,
        existingContractNumber: '476810',
        existingContractStatus: ContractStatus.ACTIVE,
      });
    });

    it('names the unit and the blocking contract in the message', async () => {
      unitHasContract(ContractStatus.ACTIVE);

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].errors[0].message).toContain('R6-101');
      expect(result.contracts[0].errors[0].message).toContain('476810');
    });

    it('allows the row when the only contract on the unit is soft-deleted', async () => {
      // The lookup filters deletedAt: null, so a deleted contract reads as absent.
      prisma.building.findFirst.mockResolvedValue({ id: BUILDING_ID });
      prisma.property.findFirst.mockResolvedValue({ id: PROPERTY_ID });
      prisma.contract.findFirst.mockResolvedValue(null);

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].status).toBe('VALID');
      expect(prisma.contract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { propertyId: PROPERTY_ID, deletedAt: null } }),
      );
    });

    it('allows the row when the unit has no contract at all', async () => {
      prisma.building.findFirst.mockResolvedValue({ id: BUILDING_ID });
      prisma.property.findFirst.mockResolvedValue({ id: PROPERTY_ID });

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].status).toBe('VALID');
    });

    it('blocks both rows when two PDFs in one batch target the same unit', async () => {
      const result = await service.resolveBatch(
        batch(extraction(), extraction({ contract: { contractNumber: 'GC-R6-101' } })),
      );

      expect(result.contracts[1].status).toBe('ERROR');
      expect(result.contracts[1].errors.some((e) => /Two PDFs in this batch/.test(e.message))).toBe(true);
      expect(result.contracts[1].errors[0].message).toContain('row 1');
    });

    it('does not block two rows targeting different units', async () => {
      const result = await service.resolveBatch(
        batch(extraction(), extraction({ unit: { unitNumber: '102' } })),
      );

      expect(result.contracts.every((r) => r.status === 'VALID')).toBe(true);
    });

    it('skips the DB check for a brand-new unit, which cannot have contracts yet', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(result.contracts[0].status).toBe('VALID');
    });
  });

  describe('building resolution (§7.1)', () => {
    it('matches an existing building by code, case-insensitively', async () => {
      prisma.building.findFirst.mockResolvedValue({ id: BUILDING_ID });

      const result = await service.resolveBatch(batch(extraction({ building: { code: 'r6' } })));

      expect(result.buildings.rows).toHaveLength(0);
      expect(prisma.building.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ code: { equals: 'r6', mode: 'insensitive' } }),
        }),
      );
    });

    describe('component matching — Green "R6" vs DMT "MZW16-R6"', () => {
      // A DMT contract yields Plot+Sector (MZW16-R6); a Green Contract carries
      // only the plot (R6). Exact matching alone created a duplicate building,
      // which then gave the unit a contract-free property and let a second
      // contract through for a unit that already had a DMT one.
      it('links the existing composite building instead of creating a second one', async () => {
        prisma.building.findMany.mockResolvedValue([{ id: BUILDING_ID, code: 'MZW16-R6' }]);

        const result = await service.resolveBatch(batch(extraction({ building: { code: 'R6' } })));

        expect(result.buildings.rows).toHaveLength(0);
        expect(result.properties.rows[0].resolvedRefs?.buildingId).toBe(BUILDING_ID);
      });

      it('matches whichever end of the code the component sits at', async () => {
        prisma.building.findMany.mockResolvedValue([{ id: BUILDING_ID, code: 'R6-MZW16' }]);

        const result = await service.resolveBatch(batch(extraction({ building: { code: 'R6' } })));

        expect(result.buildings.rows).toHaveLength(0);
      });

      it('does not match a mere substring', async () => {
        // R6 must not match R60 or AR6 — that would attach the contract to a
        // different building entirely.
        prisma.building.findMany.mockResolvedValue([
          { id: BUILDING_ID, code: 'R60-MZW16' },
          { id: PROPERTY_ID, code: 'AR6' },
        ]);

        const result = await service.resolveBatch(batch(extraction({ building: { code: 'R6' } })));

        expect(result.buildings.rows).toHaveLength(1);
        expect(result.buildings.rows[0].data.code).toBe('R6');
      });

      it('blocks the row when the code matches several buildings', async () => {
        prisma.building.findMany.mockResolvedValue([
          { id: BUILDING_ID, code: 'MZW16-R6' },
          { id: PROPERTY_ID, code: 'Z14-R6' },
        ]);

        const result = await service.resolveBatch(batch(extraction({ building: { code: 'R6' } })));

        expect(result.contracts[0].status).toBe('ERROR');
        expect(result.contracts[0].errors[0].message).toContain('MZW16-R6');
        expect(result.contracts[0].errors[0].message).toContain('Z14-R6');
      });

      it('creates nothing at all for an ambiguous row', async () => {
        prisma.building.findMany.mockResolvedValue([
          { id: BUILDING_ID, code: 'MZW16-R6' },
          { id: PROPERTY_ID, code: 'Z14-R6' },
        ]);

        const result = await service.resolveBatch(batch(extraction({ building: { code: 'R6' } })));

        expect(result.buildings.rows).toHaveLength(0);
        expect(result.properties.rows).toHaveLength(0);
        expect(result.tenants.rows).toHaveLength(0);
      });

      it('prefers an exact match over a component match', async () => {
        prisma.building.findFirst.mockResolvedValue({ id: BUILDING_ID });
        prisma.building.findMany.mockResolvedValue([{ id: PROPERTY_ID, code: 'MZW16-R6' }]);

        const result = await service.resolveBatch(batch(extraction({ building: { code: 'R6' } })));

        expect(result.properties.rows[0].resolvedRefs?.buildingId).toBe(BUILDING_ID);
      });
    });

    it('creates a candidate building when the code is unknown', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.buildings.rows).toHaveLength(1);
      expect(result.buildings.rows[0].data.code).toBe('R6');
    });

    it('never fabricates a property registration number', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.buildings.rows[0].data).not.toHaveProperty('propertyRegistrationNo');
    });

    it('uses the name qualifier as the building name when present', async () => {
      const result = await service.resolveBatch(
        batch(extraction({ building: { code: 'R19', name: 'Mezan' } })),
      );

      expect(result.buildings.rows[0].data.name).toBe('Mezan');
    });

    it('collapses two contracts in the same building into one candidate', async () => {
      const result = await service.resolveBatch(
        batch(extraction(), extraction({ unit: { unitNumber: '102' } })),
      );

      expect(result.buildings.rows).toHaveLength(1);
      expect(result.properties.rows).toHaveLength(2);
    });
  });

  describe('tenant resolution (§7.3)', () => {
    it('reuses an existing tenant matched by Emirates ID', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_ID, emiratesIdNumber: '784-1990-3780179-4', tradeLicenseNumber: null, nameEn: 'X' },
      ]);

      const result = await service.resolveBatch(batch(extraction()));

      expect(result.tenants.rows).toHaveLength(0);
      expect(result.contracts[0].resolvedRefs?.tenantId).toBe(TENANT_ID);
    });

    it('matches the same person when the stored ID is punctuated differently', async () => {
      // The DB really does hold "784199037801794" while extraction returns
      // "784-1990-37801794". Exact matching created a duplicate tenant.
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_ID, emiratesIdNumber: '784199037801794', tradeLicenseNumber: null, nameEn: 'X' },
      ]);

      const result = await service.resolveBatch(
        batch(extraction({ tenant: { emiratesIdNumber: '784-1990-37801794' } })),
      );

      expect(result.tenants.rows).toHaveLength(0);
      expect(result.contracts[0].resolvedRefs?.tenantId).toBe(TENANT_ID);
    });

    it('matches a company on its licence regardless of punctuation', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_ID, emiratesIdNumber: null, tradeLicenseNumber: 'CN-1027292-2', nameEn: 'Other Name' },
      ]);

      const result = await service.resolveBatch(
        batch(
          extraction({
            tenant: {
              tenantType: 'Company',
              nameEn: 'Mezan Trading LLC',
              tradeLicenseNumber: 'CN:1027292-2',
              emiratesIdNumber: undefined,
            },
          }),
        ),
      );

      expect(result.tenants.rows).toHaveLength(0);
      expect(result.contracts[0].resolvedRefs?.tenantId).toBe(TENANT_ID);
    });

    it('reuses one tenant across two contracts in the same batch', async () => {
      const result = await service.resolveBatch(
        batch(extraction(), extraction({ unit: { unitNumber: '102' } })),
      );

      expect(result.tenants.rows).toHaveLength(1);
    });

    it('keeps two different people apart even with the same name', async () => {
      const result = await service.resolveBatch(
        batch(
          extraction({ tenant: { emiratesIdNumber: '784-1990-1111111-1' } }),
          extraction({
            unit: { unitNumber: '102' },
            tenant: { emiratesIdNumber: '784-1985-2222222-2' },
          }),
        ),
      );

      expect(result.tenants.rows).toHaveLength(2);
    });

    it('imports a tenant whose contract carries no phone number', async () => {
      // Regression: phone was required by both the DTO and the DB, so a contract
      // without one failed with "phone must be a string" and blocked the row.
      const result = await service.resolveBatch(
        batch(extraction({ tenant: { nameEn: 'Ismaeel Ali Ahmed Shaheen Alobeidli', phone: undefined } })),
      );

      expect(result.tenants.rows[0].status).toBe('VALID');
      expect(result.tenants.rows[0].errors).toEqual([]);
    });

    it('still rejects a phone that is present but malformed', async () => {
      const result = await service.resolveBatch(
        batch(extraction({ tenant: { phone: 'not a phone' } })),
      );

      expect(result.tenants.rows[0].status).toBe('ERROR');
      expect(result.tenants.rows[0].errors.some((e) => e.field === 'phone')).toBe(true);
    });

    it('does not block a company missing licence expiry / authorized person (§3)', async () => {
      const result = await service.resolveBatch(
        batch(
          extraction({
            tenant: {
              tenantType: 'Company',
              nameEn: 'Mezan Trading LLC',
              tradeLicenseNumber: 'CN:1027292-2',
              emiratesIdNumber: undefined,
            },
          }),
        ),
      );

      expect(result.tenants.rows[0].status).toBe('VALID');
    });
  });

  describe('contract row', () => {
    it('imports as ACTIVE — a signed contract is in force, not a draft', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].data.status).toBe(ContractStatus.ACTIVE);
    });

    it('keeps the derived GC- contract number', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].data.contractNumber).toBe('GC-R6-101');
    });

    it('maps Cheques and carries the installment count', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].data.paymentFrequency).toBe('CHEQUES');
      expect(result.contracts[0].data.numberOfCheques).toBe(4);
    });

    it('points at pending parents when they are new in this batch', async () => {
      const result = await service.resolveBatch(batch(extraction()));

      expect(result.contracts[0].resolvedRefs?.tenantId).toBe('pending:tenant:0');
      expect(result.contracts[0].resolvedRefs?.propertyId).toBe('pending:property:0');
    });
  });
});

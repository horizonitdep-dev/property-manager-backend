import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../../../database/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { TenantsService } from '../tenants/tenants.service';
import { ContractStatus } from '../../../common/enums/contract-status.enum';
import { PaymentFrequency } from '../../../common/enums/payment-frequency.enum';
import { PropertyStatus } from '../../../common/enums/property-status.enum';
import { ContractSource } from '../../../common/enums/contract-source.enum';
import { computeEffectiveStatus } from './helpers/contract-status.helper';

type PrismaContract = import('@prisma/client').ContractStatus;
type PrismaFrequency = import('@prisma/client').PaymentFrequency;

const mockContract = {
  id: 'contract-uuid',
  contractNumber: '202303980216',
  tenantId: 'tenant-uuid',
  propertyId: 'property-uuid',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
  annualRent: 28000,
  monthlyRent: 2330,
  paymentFrequency: PaymentFrequency.MONTHLY as unknown as PrismaFrequency,
  numberOfCheques: null,
  securityDeposit: null,
  status: ContractStatus.ACTIVE as unknown as PrismaContract,
  source: ContractSource.MANUAL,
  renewedFromId: null,
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  tenant: { id: 'tenant-uuid', nameEn: 'Ahmed Al Mansoori', nameAr: null, tenantType: 'INDIVIDUAL' },
  property: {
    id: 'property-uuid',
    unitNumber: '102',
    building: { id: 'building-uuid', name: 'Al Noor Tower', code: 'B001' },
  },
};

const baseCreateDto = {
  contractNumber: '202303980216',
  tenantId: 'tenant-uuid',
  propertyId: 'property-uuid',
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  annualRent: 28000,
  monthlyRent: 2330,
  paymentFrequency: PaymentFrequency.MONTHLY,
};

describe('ContractsService', () => {
  let service: ContractsService;
  let prisma: {
    contract: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let propertiesService: { findOne: jest.Mock; setOccupancyStatus: jest.Mock };
  let tenantsService: { ensureTenantExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      contract: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };
    propertiesService = {
      findOne: jest.fn().mockResolvedValue({ id: 'property-uuid' }),
      setOccupancyStatus: jest.fn().mockResolvedValue(undefined),
    };
    tenantsService = {
      ensureTenantExists: jest.fn().mockResolvedValue({ id: 'tenant-uuid' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PropertiesService, useValue: propertiesService },
        { provide: TenantsService, useValue: tenantsService },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list ordering', () => {
    beforeEach(() => {
      prisma.contract.findMany.mockResolvedValue([mockContract]);
      prisma.contract.count.mockResolvedValue(1);
    });

    function orderByOf() {
      return prisma.contract.findMany.mock.calls[0][0].orderBy;
    }

    it('groups by building then unit by default', async () => {
      // Previously createdAt desc, which scattered one building's units across
      // the whole list.
      await service.findAll({});

      expect(orderByOf()).toEqual([
        { property: { building: { code: 'asc' } } },
        { property: { unitNumber: 'asc' } },
        { startDate: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('shows the newest contract first when a unit has several', async () => {
      await service.findAll({});

      expect(orderByOf()[2]).toEqual({ startDate: 'desc' });
    });

    it('tie-breaks on id so pagination is stable', async () => {
      await service.findAll({});

      expect(orderByOf().at(-1)).toEqual({ id: 'asc' });
    });

    it('still supports the flat sorts, newest first', async () => {
      await service.findAll({ sortBy: 'startDate' });

      expect(orderByOf()).toEqual([{ startDate: 'desc' }, { id: 'asc' }]);
    });

    it('honours an explicit direction', async () => {
      await service.findAll({ sortBy: 'annualRent', sortOrder: 'asc' });

      expect(orderByOf()[0]).toEqual({ annualRent: 'asc' });
    });

    it('can reverse the building grouping', async () => {
      await service.findAll({ sortBy: 'building', sortOrder: 'desc' });

      expect(orderByOf()[0]).toEqual({ property: { building: { code: 'desc' } } });
    });
  });

  describe('contract source (spec §8.3/§8.4)', () => {
    beforeEach(() => {
      prisma.contract.create.mockResolvedValue(mockContract);
    });

    it('defaults to MANUAL when no importer supplies one', async () => {
      // POST /contracts goes through the controller, which never passes a source.
      await service.create({ ...baseCreateDto, status: ContractStatus.DRAFT }, 'user-uuid');

      expect(prisma.contract.create.mock.calls[0][0].data.source).toBe(ContractSource.MANUAL);
    });

    it.each([
      [ContractSource.DMT_TAWTHEEQ],
      [ContractSource.CSV_IMPORT],
      [ContractSource.R6_GREEN_CONTRACT],
    ])('records %s when the importer declares it', async (source) => {
      await service.create(
        { ...baseCreateDto, status: ContractStatus.DRAFT },
        'user-uuid',
        undefined,
        source,
      );

      expect(prisma.contract.create.mock.calls[0][0].data.source).toBe(source);
    });

    it('cannot be spoofed through the create DTO', async () => {
      // `source` is a service parameter, not a DTO field, so a request body
      // claiming DMT provenance is ignored rather than trusted.
      await service.create(
        { ...baseCreateDto, status: ContractStatus.DRAFT, source: ContractSource.DMT_TAWTHEEQ } as never,
        'user-uuid',
      );

      expect(prisma.contract.create.mock.calls[0][0].data.source).toBe(ContractSource.MANUAL);
    });

    it('is returned on the response so clients can show provenance', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        ...mockContract,
        source: ContractSource.DMT_TAWTHEEQ,
      });

      const result = await service.findOne('contract-uuid');

      expect(result.source).toBe(ContractSource.DMT_TAWTHEEQ);
    });

    it('filters the list by source', async () => {
      prisma.contract.findMany.mockResolvedValue([mockContract]);
      prisma.contract.count.mockResolvedValue(1);

      await service.findAll({ source: ContractSource.R6_GREEN_CONTRACT });

      expect(prisma.contract.findMany.mock.calls[0][0].where.source).toBe(
        ContractSource.R6_GREEN_CONTRACT,
      );
    });

    it('omits the source filter entirely when not requested', async () => {
      prisma.contract.findMany.mockResolvedValue([mockContract]);
      prisma.contract.count.mockResolvedValue(1);

      await service.findAll({});

      expect(prisma.contract.findMany.mock.calls[0][0].where).not.toHaveProperty('source');
    });
  });

  describe('create', () => {
    it('should create a DRAFT contract without checking for overlap', async () => {
      prisma.contract.create.mockResolvedValue({ ...mockContract, status: ContractStatus.DRAFT as unknown as PrismaContract });

      const result = await service.create({ ...baseCreateDto, status: ContractStatus.DRAFT }, 'user-uuid');

      expect(result.storedStatus).toBe(ContractStatus.DRAFT);
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(propertiesService.setOccupancyStatus).not.toHaveBeenCalled();
    });

    it('should create an ACTIVE contract, check for overlap, and flip the property to OCCUPIED', async () => {
      prisma.contract.findFirst
        .mockResolvedValueOnce(null) // overlap check: no conflict
        .mockResolvedValueOnce(mockContract); // occupancy recompute: an active contract now exists
      prisma.contract.create.mockResolvedValue(mockContract);

      const result = await service.create({ ...baseCreateDto, status: ContractStatus.ACTIVE }, 'user-uuid');

      expect(result.storedStatus).toBe(ContractStatus.ACTIVE);
      expect(prisma.contract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ propertyId: 'property-uuid', status: ContractStatus.ACTIVE }),
        }),
      );
      expect(propertiesService.setOccupancyStatus).toHaveBeenCalledWith(
        'property-uuid',
        PropertyStatus.OCCUPIED,
        'user-uuid',
        prisma,
      );
    });

    it('should throw NotFoundException when the tenant does not exist', async () => {
      tenantsService.ensureTenantExists.mockRejectedValue(new NotFoundException('Tenant not found'));

      await expect(service.create(baseCreateDto, 'user-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the property does not exist', async () => {
      propertiesService.findOne.mockRejectedValue(new NotFoundException('Property not found'));

      await expect(service.create(baseCreateDto, 'user-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when endDate is before startDate', async () => {
      await expect(
        service.create({ ...baseCreateDto, startDate: '2025-12-31', endDate: '2025-01-01' }, 'user-uuid'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when CHEQUES is chosen without numberOfCheques', async () => {
      await expect(
        service.create({ ...baseCreateDto, paymentFrequency: PaymentFrequency.CHEQUES }, 'user-uuid'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when an overlapping ACTIVE contract already exists on the property', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract); // conflicting contract found

      await expect(
        service.create({ ...baseCreateDto, status: ContractStatus.ACTIVE }, 'user-uuid'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('should allow a DRAFT contract to be created even if an overlapping ACTIVE one exists', async () => {
      prisma.contract.create.mockResolvedValue({ ...mockContract, status: ContractStatus.DRAFT as unknown as PrismaContract });

      await service.create({ ...baseCreateDto, status: ContractStatus.DRAFT }, 'user-uuid');

      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(prisma.contract.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(service.update('nonexistent', { notes: 'x' }, 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when the merged dates put endDate before startDate', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      await expect(
        service.update('contract-uuid', { startDate: '2026-01-01' }, 'user-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when merged paymentFrequency is CHEQUES with no numberOfCheques', async () => {
      prisma.contract.findFirst.mockResolvedValue(mockContract);
      await expect(
        service.update('contract-uuid', { paymentFrequency: PaymentFrequency.CHEQUES }, 'user-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update the contract and recompute property occupancy', async () => {
      prisma.contract.findFirst
        .mockResolvedValueOnce(mockContract) // current lookup
        .mockResolvedValueOnce(null) // overlap check: no conflict (merged status stays ACTIVE)
        .mockResolvedValueOnce(mockContract); // occupancy recompute: still an active contract
      prisma.contract.update.mockResolvedValue({ ...mockContract, notes: 'Updated' });

      const result = await service.update('contract-uuid', { notes: 'Updated' }, 'user-uuid');

      expect(result.notes).toBe('Updated');
      expect(propertiesService.setOccupancyStatus).toHaveBeenCalledWith(
        'property-uuid',
        expect.any(String),
        'user-uuid',
        prisma,
      );
    });
  });

  describe('renew', () => {
    it('should throw NotFoundException if the source contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(
        service.renew(
          'nonexistent',
          { contractNumber: 'R1', startDate: '2026-01-01', endDate: '2026-12-31' },
          'user-uuid',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a new linked contract without modifying the source', async () => {
      prisma.contract.findFirst
        .mockResolvedValueOnce(mockContract) // source lookup
        .mockResolvedValueOnce(null) // overlap check: no conflict
        .mockResolvedValueOnce(mockContract); // occupancy recompute: an active contract now exists
      prisma.contract.create.mockResolvedValue({
        ...mockContract,
        id: 'renewed-uuid',
        renewedFromId: 'contract-uuid',
        contractNumber: 'R1',
      });

      const result = await service.renew(
        'contract-uuid',
        { contractNumber: 'R1', startDate: '2026-01-01', endDate: '2026-12-31', status: ContractStatus.ACTIVE },
        'user-uuid',
      );

      expect(result.renewedFromId).toBe('contract-uuid');
      expect(prisma.contract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            renewedFromId: 'contract-uuid',
            tenantId: mockContract.tenantId,
            propertyId: mockContract.propertyId,
          }),
        }),
      );
      expect(prisma.contract.update).not.toHaveBeenCalled(); // source is never touched
    });
  });

  describe('terminate', () => {
    it('should throw NotFoundException if the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(service.terminate('nonexistent', {}, 'user-uuid')).rejects.toThrow(NotFoundException);
    });

    it('should set status to TERMINATED and free the property when it was the only active one', async () => {
      prisma.contract.findFirst
        .mockResolvedValueOnce(mockContract) // current lookup
        .mockResolvedValueOnce(null); // recompute: no other active contract
      prisma.contract.update.mockResolvedValue({
        ...mockContract,
        status: ContractStatus.TERMINATED as unknown as PrismaContract,
      });

      const result = await service.terminate('contract-uuid', { terminationReason: 'Vacated' }, 'user-uuid');

      expect(result.storedStatus).toBe(ContractStatus.TERMINATED);
      expect(propertiesService.setOccupancyStatus).toHaveBeenCalledWith(
        'property-uuid',
        PropertyStatus.VACANT,
        'user-uuid',
        prisma,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete by setting deletedAt', async () => {
      const deletedAt = new Date();
      prisma.contract.findFirst.mockResolvedValueOnce(mockContract).mockResolvedValueOnce(null);
      prisma.contract.update.mockResolvedValue({ ...mockContract, deletedAt });

      const result = await service.remove('contract-uuid', 'user-uuid');
      expect(result).toBeDefined();
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });

    it('should throw NotFoundException if the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);
      await expect(service.remove('nonexistent', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should always exclude soft-deleted contracts', async () => {
      prisma.contract.findMany.mockResolvedValue([mockContract]);
      prisma.contract.count.mockResolvedValue(1);

      await service.findAll({ page: 1, limit: 10 });

      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });
  });

  describe('effective status computation', () => {
    const today = new Date('2026-06-15');

    it('DRAFT stays DRAFT regardless of dates', () => {
      expect(computeEffectiveStatus(ContractStatus.DRAFT, new Date('2020-01-01'), today)).toBe(
        ContractStatus.DRAFT,
      );
    });

    it('TERMINATED stays TERMINATED regardless of dates', () => {
      expect(computeEffectiveStatus(ContractStatus.TERMINATED, new Date('2099-01-01'), today)).toBe(
        ContractStatus.TERMINATED,
      );
    });

    it('ACTIVE with endDate far in the future stays ACTIVE', () => {
      expect(computeEffectiveStatus(ContractStatus.ACTIVE, new Date('2026-12-31'), today)).toBe(
        ContractStatus.ACTIVE,
      );
    });

    it('ACTIVE with endDate within 30 days becomes EXPIRING_SOON', () => {
      expect(computeEffectiveStatus(ContractStatus.ACTIVE, new Date('2026-07-01'), today)).toBe(
        ContractStatus.EXPIRING_SOON,
      );
    });

    it('ACTIVE with endDate in the past becomes EXPIRED', () => {
      expect(computeEffectiveStatus(ContractStatus.ACTIVE, new Date('2026-01-01'), today)).toBe(
        ContractStatus.EXPIRED,
      );
    });
  });
});

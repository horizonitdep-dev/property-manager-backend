import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../../../database/prisma.service';
import { PaymentKind } from '../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../common/enums/payment-method.enum';

const mockPayment = {
  id: 'payment-uuid',
  contractId: 'contract-uuid',
  kind: PaymentKind.RENT,
  amount: new Prisma.Decimal('2000.00'),
  paidOn: new Date('2026-01-15'),
  method: PaymentMethod.BANK_TRANSFER,
  periodStart: null,
  periodEnd: null,
  chequeId: null,
  referenceNumber: 'TRX-99881',
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  contract: {
    id: 'contract-uuid',
    contractNumber: '202303980216',
    tenant: { id: 'tenant-uuid', nameEn: 'Ahmed Al Mansoori', nameAr: null, tenantType: 'INDIVIDUAL' },
    property: {
      id: 'property-uuid',
      unitNumber: '102',
      building: { id: 'building-uuid', name: 'R6-MZW16', code: 'R6-MZW16' },
    },
  },
  cheque: null,
  attachments: [],
};

const baseCreateDto = {
  contractId: 'contract-uuid',
  amount: 2000,
  paidOn: '2026-01-15',
  method: PaymentMethod.BANK_TRANSFER,
};

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    payment: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    contract: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      payment: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      contract: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('create', () => {
    it('creates a payment against an existing contract', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-uuid' });
      prisma.payment.create.mockResolvedValue(mockPayment);

      const result = await service.create(baseCreateDto, 'user-uuid');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'contract-uuid',
            kind: PaymentKind.RENT,
            createdById: 'user-uuid',
          }),
        }),
      );
      expect(result.amount).toBe('2000.00');
    });

    it('defaults kind to RENT', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-uuid' });
      prisma.payment.create.mockResolvedValue(mockPayment);

      await service.create(baseCreateDto, 'user-uuid');

      expect(prisma.payment.create.mock.calls[0][0].data.kind).toBe(PaymentKind.RENT);
    });

    it('stores the amount as a Decimal, never a float', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-uuid' });
      prisma.payment.create.mockResolvedValue(mockPayment);

      await service.create({ ...baseCreateDto, amount: 2000.1 }, 'user-uuid');

      const { amount } = prisma.payment.create.mock.calls[0][0].data;
      expect(amount).toBeInstanceOf(Prisma.Decimal);
      expect(amount.toFixed(2)).toBe('2000.10');
    });

    it('404s when the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, 'user-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('404s when the contract is soft-deleted', async () => {
      // ensureContractExists filters deletedAt: null, so a deleted contract reads as absent.
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, 'user-uuid')).rejects.toThrow('Contract not found');
      expect(prisma.contract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'contract-uuid', deletedAt: null } }),
      );
    });

    it('never sets chequeId — that path belongs to the cheque clear action', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-uuid' });
      prisma.payment.create.mockResolvedValue(mockPayment);

      await service.create({ ...baseCreateDto, chequeId: 'sneaky' } as never, 'user-uuid');

      expect(prisma.payment.create.mock.calls[0][0].data).not.toHaveProperty('chequeId');
    });
  });

  describe('update', () => {
    it('updates a manual payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, chequeId: null });
      prisma.payment.update.mockResolvedValue(mockPayment);

      await service.update('payment-uuid', { amount: 2500 }, 'user-uuid');

      const { data } = prisma.payment.update.mock.calls[0][0];
      expect(data.amount.toFixed(2)).toBe('2500.00');
      expect(data.updatedById).toBe('user-uuid');
    });

    it('409s when changing the amount of a cheque-linked payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, chequeId: 'cheque-uuid' });

      await expect(service.update('payment-uuid', { amount: 2500 }, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('409s when changing paidOn of a cheque-linked payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, chequeId: 'cheque-uuid' });

      await expect(
        service.update('payment-uuid', { paidOn: '2026-02-01' }, 'user-uuid'),
      ).rejects.toThrow(/cheque is the source of truth/);
    });

    it('names every offending field in the 409', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, chequeId: 'cheque-uuid' });

      await expect(
        service.update('payment-uuid', { amount: 1, paidOn: '2026-02-01' }, 'user-uuid'),
      ).rejects.toThrow(/amount, paidOn/);
    });

    it('still allows metadata edits on a cheque-linked payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, chequeId: 'cheque-uuid' });
      prisma.payment.update.mockResolvedValue(mockPayment);

      await service.update('payment-uuid', { notes: 'cleared late' }, 'user-uuid');

      expect(prisma.payment.update).toHaveBeenCalled();
    });

    it('404s for a missing payment', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.update('payment-uuid', { notes: 'x' }, 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft deletes rather than hard deleting', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);
      prisma.payment.update.mockResolvedValue({ ...mockPayment, deletedAt: new Date() });

      await service.remove('payment-uuid', 'user-uuid');

      const { data } = prisma.payment.update.mock.calls[0][0];
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.updatedById).toBe('user-uuid');
    });

    it('404s for a missing payment', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.remove('payment-uuid', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll filters', () => {
    beforeEach(() => {
      prisma.payment.findMany.mockResolvedValue([mockPayment]);
      prisma.payment.count.mockResolvedValue(1);
    });

    function whereOf() {
      return prisma.payment.findMany.mock.calls[0][0].where;
    }

    it('excludes soft-deleted payments and soft-deleted contracts by default', async () => {
      await service.findAll({});

      expect(whereOf().deletedAt).toBeNull();
      expect(whereOf().contract).toEqual({ deletedAt: null });
    });

    it('can include payments of soft-deleted contracts when asked (spec §5.4)', async () => {
      await service.findAll({ includeDeletedContracts: true });

      expect(whereOf().contract).not.toHaveProperty('deletedAt');
    });

    it('resolves buildingId through contract → property', async () => {
      await service.findAll({ buildingId: 'building-uuid' });

      expect(whereOf().contract).toEqual({ deletedAt: null, property: { buildingId: 'building-uuid' } });
    });

    it('resolves tenantId through the contract', async () => {
      await service.findAll({ tenantId: 'tenant-uuid' });

      expect(whereOf().contract).toEqual({ deletedAt: null, tenantId: 'tenant-uuid' });
    });

    it('filters an inclusive paidOn range', async () => {
      await service.findAll({ paidOnFrom: '2026-01-01', paidOnTo: '2026-12-31' });

      expect(whereOf().paidOn).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-12-31'),
      });
    });

    it('separates cheque-linked from manual payments', async () => {
      await service.findAll({ linkedToCheque: true });
      expect(whereOf().chequeId).toEqual({ not: null });

      prisma.payment.findMany.mockClear();
      await service.findAll({ linkedToCheque: false });
      expect(prisma.payment.findMany.mock.calls[0][0].where.chequeId).toBeNull();
    });

    it('omits the cheque filter entirely when not specified', async () => {
      await service.findAll({});

      expect(whereOf()).not.toHaveProperty('chequeId');
    });

    it('returns pagination meta', async () => {
      prisma.payment.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, limit: 10 });

      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });
  });

  describe('response shape', () => {
    it('serialises amount as a fixed-2 string, not a number', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);

      const result = await service.findOne('payment-uuid');

      expect(result.amount).toBe('2000.00');
      expect(typeof result.amount).toBe('string');
    });

    it('flags cheque-linked payments so clients can disable editing', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, chequeId: 'cheque-uuid' });

      const result = await service.findOne('payment-uuid');

      expect(result.isChequeLinked).toBe(true);
    });

    it('reports manual payments as not cheque-linked', async () => {
      prisma.payment.findFirst.mockResolvedValue(mockPayment);

      const result = await service.findOne('payment-uuid');

      expect(result.isChequeLinked).toBe(false);
    });

    it('404s for a missing payment', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.findOne('payment-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllByContract', () => {
    it('404s when the contract does not exist', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(service.findAllByContract('contract-uuid', {})).rejects.toThrow(NotFoundException);
    });

    it('scopes the list to that contract', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-uuid' });
      prisma.payment.findMany.mockResolvedValue([mockPayment]);
      prisma.payment.count.mockResolvedValue(1);

      await service.findAllByContract('contract-uuid', {});

      expect(prisma.payment.findMany.mock.calls[0][0].where.contractId).toBe('contract-uuid');
    });
  });
});

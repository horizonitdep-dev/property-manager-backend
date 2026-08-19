import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../../../../database/prisma.service';
import { ExpenseCategory } from '../../../../common/enums/expense-category.enum';
import { ExpenseSourceType } from '../../../../common/enums/expense-source-type.enum';
import { PaymentMethod } from '../../../../common/enums/payment-method.enum';

const mockExpense = {
  id: 'expense-uuid',
  buildingId: 'building-uuid',
  propertyId: null as string | null,
  category: ExpenseCategory.MAINTENANCE,
  amount: new Prisma.Decimal('1500.00'),
  incurredOn: new Date('2026-02-10'),
  vendorName: 'Al Reem Maintenance LLC',
  description: 'Replaced the lobby AC compressor',
  method: PaymentMethod.BANK_TRANSFER,
  invoiceNumber: 'INV-2026-0042',
  sourceType: ExpenseSourceType.GENERAL,
  sourceRefId: null as string | null,
  sourceRefType: null as string | null,
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  building: { id: 'building-uuid', name: 'R6-MZW16', code: 'R6-MZW16' },
  property: null,
  attachments: [],
};

const baseCreateDto = {
  buildingId: 'building-uuid',
  category: ExpenseCategory.MAINTENANCE,
  amount: 1500,
  incurredOn: '2026-02-10',
  vendorName: 'Al Reem Maintenance LLC',
  description: 'Replaced the lobby AC compressor',
  method: PaymentMethod.BANK_TRANSFER,
};

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: {
    expense: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    building: { findFirst: jest.Mock };
    property: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      expense: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn().mockResolvedValue(mockExpense),
        update: jest.fn().mockResolvedValue(mockExpense),
      },
      building: { findFirst: jest.fn().mockResolvedValue({ id: 'building-uuid' }) },
      property: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpensesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ExpensesService);
  });

  describe('create', () => {
    it('creates a building-level expense defaulting to GENERAL', async () => {
      await service.create(baseCreateDto, 'user-uuid');

      const { data } = prisma.expense.create.mock.calls[0][0];
      expect(data.sourceType).toBe(ExpenseSourceType.GENERAL);
      expect(data.buildingId).toBe('building-uuid');
      expect(data.amount).toBeInstanceOf(Prisma.Decimal);
    });

    it('404s when the building does not exist', async () => {
      prisma.building.findFirst.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, 'user-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('accepts a unit that belongs to the building', async () => {
      prisma.property.findFirst.mockResolvedValue({
        id: 'property-uuid',
        buildingId: 'building-uuid',
        unitNumber: '102',
      });

      await expect(
        service.create({ ...baseCreateDto, propertyId: 'property-uuid' }, 'user-uuid'),
      ).resolves.toBeDefined();
    });

    it('400s when the unit belongs to a different building', async () => {
      // The DB cannot express this with two independent FKs, so it is checked here.
      prisma.property.findFirst.mockResolvedValue({
        id: 'property-uuid',
        buildingId: 'a-different-building',
        unitNumber: '204',
      });

      await expect(
        service.create({ ...baseCreateDto, propertyId: 'property-uuid' }, 'user-uuid'),
      ).rejects.toThrow(/Unit 204 does not belong to the building/);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });

    it('404s when the referenced unit does not exist', async () => {
      prisma.property.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...baseCreateDto, propertyId: 'property-uuid' }, 'user-uuid'),
      ).rejects.toThrow('Property not found');
    });

    it('requires source refs when sourceType is not GENERAL', async () => {
      await expect(
        service.create(
          { ...baseCreateDto, sourceType: ExpenseSourceType.WORK_ORDER },
          'user-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('names both missing source fields', async () => {
      await expect(
        service.create({ ...baseCreateDto, sourceType: ExpenseSourceType.WORK_ORDER }, 'user-uuid'),
      ).rejects.toThrow(/sourceRefId and sourceRefType are required when sourceType is WORK_ORDER/);
    });

    it('rejects a partial source ref pair', async () => {
      await expect(
        service.create(
          {
            ...baseCreateDto,
            sourceType: ExpenseSourceType.WORK_ORDER,
            sourceRefId: 'work-order-uuid',
          },
          'user-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a complete WORK_ORDER expense — the extension point', async () => {
      await expect(
        service.create(
          {
            ...baseCreateDto,
            sourceType: ExpenseSourceType.WORK_ORDER,
            sourceRefId: '11111111-1111-1111-1111-111111111111',
            sourceRefType: 'work_order',
          },
          'user-uuid',
        ),
      ).resolves.toBeDefined();

      const { data } = prisma.expense.create.mock.calls[0][0];
      expect(data.sourceType).toBe(ExpenseSourceType.WORK_ORDER);
      expect(data.sourceRefType).toBe('work_order');
    });
  });

  describe('update', () => {
    it('updates a GENERAL expense', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);

      await service.update('expense-uuid', { amount: 1750 }, 'user-uuid');

      const { data } = prisma.expense.update.mock.calls[0][0];
      expect(data.amount.toFixed(2)).toBe('1750.00');
      expect(data.updatedById).toBe('user-uuid');
    });

    it('409s on an expense owned by another module', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        ...mockExpense,
        sourceType: ExpenseSourceType.WORK_ORDER,
        sourceRefType: 'work_order',
      });

      await expect(service.update('expense-uuid', { amount: 1750 }, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });

    it('names the owning module in the 409', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        ...mockExpense,
        sourceType: ExpenseSourceType.WORK_ORDER,
        sourceRefType: 'work_order',
      });

      await expect(service.update('expense-uuid', { notes: 'x' }, 'user-uuid')).rejects.toThrow(
        /created by work_order and cannot be edited here/,
      );
    });

    it('re-checks containment when only the property changes', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);
      prisma.property.findFirst.mockResolvedValue({
        id: 'property-uuid',
        buildingId: 'a-different-building',
        unitNumber: '204',
      });

      await expect(
        service.update('expense-uuid', { propertyId: 'property-uuid' }, 'user-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-checks containment when only the building changes', async () => {
      // Moving the building out from under an existing unit must not be allowed.
      prisma.expense.findFirst.mockResolvedValue({ ...mockExpense, propertyId: 'property-uuid' });
      prisma.property.findFirst.mockResolvedValue({
        id: 'property-uuid',
        buildingId: 'building-uuid',
        unitNumber: '102',
      });

      await expect(
        service.update('expense-uuid', { buildingId: 'another-building-uuid' }, 'user-uuid'),
      ).rejects.toThrow(/does not belong to the building/);
    });

    it('does not re-validate the unit when neither side of the pair changes', async () => {
      // A notes-only edit must not spend a query re-checking containment, and must
      // not fail if the attached unit has since been soft-deleted.
      prisma.expense.findFirst.mockResolvedValue({ ...mockExpense, propertyId: 'property-uuid' });

      await service.update('expense-uuid', { notes: 'reconciled' }, 'user-uuid');

      expect(prisma.property.findFirst).not.toHaveBeenCalled();
      expect(prisma.expense.update).toHaveBeenCalled();
    });

    it('does not re-validate when the building is re-sent unchanged', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);

      await service.update('expense-uuid', { buildingId: 'building-uuid', notes: 'x' }, 'user-uuid');

      expect(prisma.property.findFirst).not.toHaveBeenCalled();
    });

    it('404s for a missing expense', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.update('expense-uuid', { notes: 'x' }, 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft deletes', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);

      await service.remove('expense-uuid', 'user-uuid');

      expect(prisma.expense.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    });

    it('404s for a missing expense', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.remove('expense-uuid', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll filters', () => {
    beforeEach(() => {
      prisma.expense.findMany.mockResolvedValue([mockExpense]);
      prisma.expense.count.mockResolvedValue(1);
    });

    function whereOf() {
      return prisma.expense.findMany.mock.calls[0][0].where;
    }

    it('excludes soft-deleted expenses', async () => {
      await service.findAll({});

      expect(whereOf().deletedAt).toBeNull();
    });

    it('filters by category', async () => {
      await service.findAll({ category: ExpenseCategory.UTILITY });

      expect(whereOf().category).toBe(ExpenseCategory.UTILITY);
    });

    it('filters by source type', async () => {
      await service.findAll({ sourceType: ExpenseSourceType.WORK_ORDER });

      expect(whereOf().sourceType).toBe(ExpenseSourceType.WORK_ORDER);
    });

    it('filters by building and property', async () => {
      await service.findAll({ buildingId: 'building-uuid', propertyId: 'property-uuid' });

      expect(whereOf().buildingId).toBe('building-uuid');
      expect(whereOf().propertyId).toBe('property-uuid');
    });

    it('filters an inclusive incurredOn range', async () => {
      await service.findAll({ incurredOnFrom: '2026-01-01', incurredOnTo: '2026-12-31' });

      expect(whereOf().incurredOn).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-12-31'),
      });
    });

    it('searches vendor, description and invoice number together', async () => {
      await service.findAll({ search: 'compressor' });

      expect(whereOf().OR).toEqual([
        { vendorName: { contains: 'compressor', mode: 'insensitive' } },
        { description: { contains: 'compressor', mode: 'insensitive' } },
        { invoiceNumber: { contains: 'compressor', mode: 'insensitive' } },
      ]);
    });
  });

  describe('scoped lists', () => {
    beforeEach(() => {
      prisma.expense.findMany.mockResolvedValue([mockExpense]);
      prisma.expense.count.mockResolvedValue(1);
    });

    it('404s for an unknown building', async () => {
      prisma.building.findFirst.mockResolvedValue(null);

      await expect(service.findAllByBuilding('building-uuid', {})).rejects.toThrow(NotFoundException);
    });

    it('404s for an unknown property', async () => {
      prisma.property.findFirst.mockResolvedValue(null);

      await expect(service.findAllByProperty('property-uuid', {})).rejects.toThrow(NotFoundException);
    });

    it('scopes to the building', async () => {
      await service.findAllByBuilding('building-uuid', {});

      expect(prisma.expense.findMany.mock.calls[0][0].where.buildingId).toBe('building-uuid');
    });
  });

  describe('response shape', () => {
    it('serialises amount as a string', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);

      const result = await service.findOne('expense-uuid');

      expect(result.amount).toBe('1500.00');
    });

    it('marks GENERAL expenses editable', async () => {
      prisma.expense.findFirst.mockResolvedValue(mockExpense);

      expect((await service.findOne('expense-uuid')).isEditable).toBe(true);
    });

    it('marks module-owned expenses not editable, so the UI can hide the button', async () => {
      prisma.expense.findFirst.mockResolvedValue({
        ...mockExpense,
        sourceType: ExpenseSourceType.WORK_ORDER,
      });

      expect((await service.findOne('expense-uuid')).isEditable).toBe(false);
    });

    it('404s for a missing expense', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.findOne('expense-uuid')).rejects.toThrow(NotFoundException);
    });
  });
});

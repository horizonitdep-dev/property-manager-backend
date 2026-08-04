import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PrismaService } from '../../../database/prisma.service';
import { UnitType } from '../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../common/enums/property-status.enum';

const mockBuilding = {
  id: 'building-uuid',
  name: 'Al Noor Tower',
  code: 'B001',
  deletedAt: null,
};

const mockProperty = {
  id: 'property-uuid',
  unitNumber: '101',
  buildingId: 'building-uuid',
  floor: 1,
  unitType: UnitType.APARTMENT as unknown as import('@prisma/client').UnitType,
  bedrooms: 2,
  bathrooms: 1,
  sizeSqm: 85.5,
  monthlyRent: 2500,
  status: PropertyStatus.VACANT as unknown as import('@prisma/client').PropertyStatus,
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  building: { id: 'building-uuid', name: 'Al Noor Tower', code: 'B001' },
};

describe('PropertiesService', () => {
  let service: PropertiesService;
  let prisma: {
    property: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    building: {
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      property: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      building: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PropertiesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PropertiesService>(PropertiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated properties', async () => {
      prisma.property.findMany.mockResolvedValue([mockProperty]);
      prisma.property.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should filter by buildingId, unitType and status', async () => {
      prisma.property.findMany.mockResolvedValue([mockProperty]);
      prisma.property.count.mockResolvedValue(1);

      await service.findAll({
        buildingId: 'building-uuid',
        unitType: UnitType.APARTMENT,
        status: PropertyStatus.VACANT,
      });

      expect(prisma.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            buildingId: 'building-uuid',
            unitType: UnitType.APARTMENT,
            status: PropertyStatus.VACANT,
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return property when found', async () => {
      prisma.property.findFirst.mockResolvedValue(mockProperty);
      const result = await service.findOne('property-uuid');
      expect(result.id).toBe('property-uuid');
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const createDto = {
      unitNumber: '101',
      buildingId: 'building-uuid',
      floor: 1,
      unitType: UnitType.APARTMENT,
      monthlyRent: 2500,
    };

    it('should throw NotFoundException when building does not exist', async () => {
      prisma.building.findFirst.mockResolvedValue(null);

      await expect(service.create(createDto, 'user-uuid')).rejects.toThrow(NotFoundException);
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate unitNumber in same building', async () => {
      prisma.building.findFirst.mockResolvedValue(mockBuilding);
      prisma.property.findFirst.mockResolvedValue(mockProperty);

      await expect(service.create(createDto, 'user-uuid')).rejects.toThrow(ConflictException);
    });

    it('should create property successfully', async () => {
      prisma.building.findFirst.mockResolvedValue(mockBuilding);
      prisma.property.findFirst.mockResolvedValue(null);
      prisma.property.create.mockResolvedValue(mockProperty);

      const result = await service.create(createDto, 'user-uuid');
      expect(result.unitNumber).toBe('101');
    });

    it('should allow the same unitNumber in a different building', async () => {
      prisma.building.findFirst.mockResolvedValue({ ...mockBuilding, id: 'other-building' });
      prisma.property.findFirst.mockResolvedValue(null);
      prisma.property.create.mockResolvedValue({ ...mockProperty, buildingId: 'other-building' });

      const result = await service.create(
        { ...createDto, buildingId: 'other-building' },
        'user-uuid',
      );
      expect(result.buildingId).toBe('other-building');
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if property does not exist', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(
        service.update('nonexistent', { unitNumber: '999' }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update property', async () => {
      prisma.property.findFirst.mockResolvedValueOnce(mockProperty).mockResolvedValueOnce(null);
      prisma.property.update.mockResolvedValue({ ...mockProperty, monthlyRent: 2700 });

      const result = await service.update('property-uuid', { monthlyRent: 2700 }, 'user-uuid');
      expect(result.monthlyRent).toBe(2700);
    });
  });

  describe('remove', () => {
    it('should soft delete property by setting deletedAt', async () => {
      const deletedAt = new Date();
      prisma.property.findFirst.mockResolvedValue(mockProperty);
      prisma.property.update.mockResolvedValue({ ...mockProperty, deletedAt });

      const result = await service.remove('property-uuid', 'user-uuid');
      expect(result.deletedAt).toEqual(deletedAt);
    });

    it('should throw NotFoundException if property not found', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      await expect(service.remove('nonexistent', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setOccupancyStatus', () => {
    it('should flip a VACANT property to OCCUPIED', async () => {
      prisma.property.findFirst.mockResolvedValue({ ...mockProperty, status: PropertyStatus.VACANT });
      prisma.property.update.mockResolvedValue({ ...mockProperty, status: PropertyStatus.OCCUPIED });

      await service.setOccupancyStatus('property-uuid', PropertyStatus.OCCUPIED, 'user-uuid');

      expect(prisma.property.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'property-uuid' },
          data: expect.objectContaining({ status: PropertyStatus.OCCUPIED }),
        }),
      );
    });

    it('should NOT override a property manually set to UNDER_MAINTENANCE', async () => {
      prisma.property.findFirst.mockResolvedValue({
        ...mockProperty,
        status: PropertyStatus.UNDER_MAINTENANCE,
      });

      await service.setOccupancyStatus('property-uuid', PropertyStatus.VACANT, 'user-uuid');

      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it('should NOT override a property manually set to RESERVED', async () => {
      prisma.property.findFirst.mockResolvedValue({ ...mockProperty, status: PropertyStatus.RESERVED });

      await service.setOccupancyStatus('property-uuid', PropertyStatus.OCCUPIED, 'user-uuid');

      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it('should be a no-op when the property is already in the desired status', async () => {
      prisma.property.findFirst.mockResolvedValue({ ...mockProperty, status: PropertyStatus.OCCUPIED });

      await service.setOccupancyStatus('property-uuid', PropertyStatus.OCCUPIED, 'user-uuid');

      expect(prisma.property.update).not.toHaveBeenCalled();
    });
  });
});

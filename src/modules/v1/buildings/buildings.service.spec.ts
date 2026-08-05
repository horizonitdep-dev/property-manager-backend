import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { PrismaService } from '../../../database/prisma.service';
import { BuildingType } from '../../../common/enums/building-type.enum';
import { ConstructionStatus } from '../../../common/enums/construction-status.enum';

const mockBuilding = {
  id: 'building-uuid',
  name: 'Al Noor Tower',
  code: 'B001',
  address: 'Hamdan Street, Abu Dhabi',
  city: 'Abu Dhabi',
  buildingType: BuildingType.RESIDENTIAL as unknown as import('@prisma/client').BuildingType,
  totalFloors: 12,
  yearBuilt: 2015,
  totalUnits: 96,
  constructionStatus:
    ConstructionStatus.COMPLETE as unknown as import('@prisma/client').ConstructionStatus,
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('BuildingsService', () => {
  let service: BuildingsService;
  let prisma: {
    building: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      building: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BuildingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BuildingsService>(BuildingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated buildings', async () => {
      prisma.building.findMany.mockResolvedValue([mockBuilding]);
      prisma.building.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPrevPage).toBe(false);
    });

    it('should compute pagination meta correctly', async () => {
      prisma.building.findMany.mockResolvedValue([mockBuilding]);
      prisma.building.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, limit: 10 });
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPrevPage).toBe(true);
    });
  });

  describe('findOne', () => {
    it('should return building when found', async () => {
      prisma.building.findFirst.mockResolvedValue(mockBuilding);
      const result = await service.findOne('building-uuid');
      expect(result.id).toBe('building-uuid');
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should throw ConflictException on duplicate code', async () => {
      prisma.building.findFirst.mockResolvedValue(mockBuilding);
      await expect(
        service.create(
          {
            name: 'Another Tower',
            code: 'B001',
            address: 'Some Street',
            city: 'Dubai',
            buildingType: BuildingType.COMMERCIAL,
            totalFloors: 5,
          },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should create building successfully', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      prisma.building.create.mockResolvedValue(mockBuilding);

      const result = await service.create(
        {
          name: 'Al Noor Tower',
          code: 'B001',
          address: 'Hamdan Street',
          city: 'Abu Dhabi',
          buildingType: BuildingType.RESIDENTIAL,
          totalFloors: 12,
        },
        'user-uuid',
      );

      expect(result.code).toBe('B001');
    });

    it('should pass totalUnits and constructionStatus through to create', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      prisma.building.create.mockResolvedValue(mockBuilding);

      await service.create(
        {
          name: 'Al Noor Tower',
          code: 'B001',
          address: 'Hamdan Street',
          city: 'Abu Dhabi',
          buildingType: BuildingType.RESIDENTIAL,
          totalFloors: 12,
          totalUnits: 96,
          constructionStatus: ConstructionStatus.UNDER_CONSTRUCTION,
        },
        'user-uuid',
      );

      expect(prisma.building.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalUnits: 96,
            constructionStatus: ConstructionStatus.UNDER_CONSTRUCTION,
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if building does not exist', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      await expect(service.update('nonexistent', { name: 'X' }, 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if new code already used by another building', async () => {
      prisma.building.findFirst.mockResolvedValue(mockBuilding);
      prisma.building.findFirst
        .mockResolvedValueOnce(mockBuilding)
        .mockResolvedValueOnce({ ...mockBuilding, id: 'other-id' });

      await expect(service.update('building-uuid', { code: 'B001' }, 'user-uuid')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should update building', async () => {
      prisma.building.findFirst.mockResolvedValueOnce(mockBuilding).mockResolvedValueOnce(null);
      prisma.building.update.mockResolvedValue({ ...mockBuilding, name: 'Updated Name' });

      const result = await service.update('building-uuid', { name: 'Updated Name' }, 'user-uuid');
      expect(result.name).toBe('Updated Name');
    });

    it('should update totalUnits and constructionStatus', async () => {
      prisma.building.findFirst.mockResolvedValueOnce(mockBuilding);
      prisma.building.update.mockResolvedValue({
        ...mockBuilding,
        totalUnits: 50,
        constructionStatus: ConstructionStatus.UNDER_CONSTRUCTION,
      });

      const result = await service.update(
        'building-uuid',
        { totalUnits: 50, constructionStatus: ConstructionStatus.UNDER_CONSTRUCTION },
        'user-uuid',
      );

      expect(result.totalUnits).toBe(50);
      expect(result.constructionStatus).toBe(ConstructionStatus.UNDER_CONSTRUCTION);
    });
  });

  describe('remove', () => {
    it('should soft delete building by setting deletedAt', async () => {
      const deletedAt = new Date();
      prisma.building.findFirst.mockResolvedValue(mockBuilding);
      prisma.building.update.mockResolvedValue({ ...mockBuilding, deletedAt });

      const result = await service.remove('building-uuid', 'user-uuid');
      expect(result.deletedAt).toEqual(deletedAt);
      expect(prisma.building.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'building-uuid' },
          data: expect.objectContaining({ updatedById: 'user-uuid' }),
        }),
      );
    });

    it('should throw NotFoundException if building not found', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      await expect(service.remove('nonexistent', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });
});

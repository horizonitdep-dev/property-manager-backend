import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../../../database/prisma.service';
import { TenantType } from '../../../common/enums/tenant-type.enum';
import { TenantStatus } from '../../../common/enums/tenant-status.enum';

const mockIndividualTenant = {
  id: 'tenant-uuid-1',
  tenantType: TenantType.INDIVIDUAL as unknown as import('@prisma/client').TenantType,
  nameEn: 'Ahmed Al Mansoori',
  nameAr: 'أحمد المنصوري',
  phone: '+971501234567',
  alternatePhone: null,
  email: 'ahmed@example.com',
  nationality: 'UAE',
  emiratesIdNumber: '784-1990-1234567-1',
  emiratesIdExpiry: new Date('2027-01-31'),
  passportNumber: 'P1234567',
  passportExpiry: new Date('2029-06-30'),
  tradeLicenseNumber: null,
  tradeLicenseExpiry: null,
  authorizedPersonNameEn: null,
  authorizedPersonNameAr: null,
  authorizedPersonOccupation: null,
  authorizedPersonPhone: null,
  status: TenantStatus.ACTIVE as unknown as import('@prisma/client').TenantStatus,
  notes: null,
  createdById: 'user-uuid',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  documents: [],
  _count: { documents: 0 },
};

const mockCompanyTenant = {
  ...mockIndividualTenant,
  id: 'tenant-uuid-2',
  tenantType: TenantType.COMPANY as unknown as import('@prisma/client').TenantType,
  nameEn: 'Al Falah Trading LLC',
  nameAr: 'شركة الفلاح للتجارة',
  emiratesIdNumber: null,
  emiratesIdExpiry: null,
  passportNumber: null,
  passportExpiry: null,
  tradeLicenseNumber: 'CN-1234567',
  tradeLicenseExpiry: new Date('2026-12-31'),
  authorizedPersonNameEn: 'Khalid Al Suwaidi',
  authorizedPersonOccupation: 'General Manager',
};

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: {
    tenant: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const baseIndividualDto = {
      tenantType: TenantType.INDIVIDUAL,
      nameEn: 'Ahmed Al Mansoori',
      phone: '+971501234567',
      emiratesIdNumber: '784-1990-1234567-1',
      emiratesIdExpiry: '2027-01-31',
      passportNumber: 'P1234567',
      passportExpiry: '2029-06-30',
    };

    const baseCompanyDto = {
      tenantType: TenantType.COMPANY,
      nameEn: 'Al Falah Trading LLC',
      phone: '+97126543210',
      tradeLicenseNumber: 'CN-1234567',
      tradeLicenseExpiry: '2026-12-31',
      authorizedPersonNameEn: 'Khalid Al Suwaidi',
      authorizedPersonOccupation: 'General Manager',
    };

    it('should create an INDIVIDUAL tenant successfully', async () => {
      prisma.tenant.create.mockResolvedValue(mockIndividualTenant);

      const result = await service.create(baseIndividualDto, 'user-uuid');
      expect(result.nameEn).toBe('Ahmed Al Mansoori');
      expect(prisma.tenant.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException when INDIVIDUAL is missing emiratesIdNumber', async () => {
      const incompleteDto: Record<string, unknown> = { ...baseIndividualDto };
      delete incompleteDto.emiratesIdNumber;

      await expect(service.create(incompleteDto as never, 'user-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it('should create a COMPANY tenant successfully', async () => {
      prisma.tenant.create.mockResolvedValue(mockCompanyTenant);

      const result = await service.create(baseCompanyDto, 'user-uuid');
      expect(result.nameEn).toBe('Al Falah Trading LLC');
      expect(prisma.tenant.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException when COMPANY is missing tradeLicenseNumber', async () => {
      const incompleteDto: Record<string, unknown> = { ...baseCompanyDto };
      delete incompleteDto.tradeLicenseNumber;

      await expect(service.create(incompleteDto as never, 'user-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should match tenants by Arabic name search', async () => {
      prisma.tenant.findMany.mockResolvedValue([mockIndividualTenant]);
      prisma.tenant.count.mockResolvedValue(1);

      await service.findAll({ search: 'المنصوري' });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { nameEn: { contains: 'المنصوري', mode: 'insensitive' } },
              { nameAr: { contains: 'المنصوري', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should exclude ID/licence numbers from the list response', async () => {
      prisma.tenant.findMany.mockResolvedValue([mockIndividualTenant]);
      prisma.tenant.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items[0]).not.toHaveProperty('emiratesIdNumber');
      expect(result.items[0]).not.toHaveProperty('passportNumber');
      expect(result.items[0]).not.toHaveProperty('tradeLicenseNumber');
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: mockIndividualTenant.id,
          nameEn: mockIndividualTenant.nameEn,
          documentCount: 0,
        }),
      );
    });
  });

  describe('remove', () => {
    it('should soft delete a tenant and exclude it from subsequent findOne calls', async () => {
      prisma.tenant.findFirst.mockResolvedValueOnce(mockIndividualTenant);
      prisma.tenant.update.mockResolvedValue({ ...mockIndividualTenant, deletedAt: new Date() });

      const result = await service.remove(mockIndividualTenant.id, 'user-uuid');
      expect(result.deletedAt).not.toBeNull();

      // A soft-deleted tenant is filtered out by findOne's `deletedAt: null` clause.
      prisma.tenant.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne(mockIndividualTenant.id)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if tenant does not exist', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);
      await expect(service.remove('nonexistent', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });
});

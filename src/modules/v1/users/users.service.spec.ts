import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../../../database/prisma.service';
import { UserRole } from '../../../common/enums/user-role.enum';

const mockUser = {
  id: 'user-uuid',
  email: 'test@horizonpm.com',
  passwordHash: 'hashed',
  refreshTokenHash: null,
  fullName: 'Test User',
  role: UserRole.SECRETARY as unknown as import('@prisma/client').UserRole,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return sanitized users without sensitive fields', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);
      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('passwordHash');
      expect(result[0]).not.toHaveProperty('refreshTokenHash');
      expect(result[0].email).toBe('test@horizonpm.com');
    });
  });

  describe('findOne', () => {
    it('should return sanitized user by id', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.findOne('user-uuid');
      expect(result.id).toBe('user-uuid');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should throw ConflictException if email is already in use', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(
        service.create({
          email: 'test@horizonpm.com',
          password: 'SecurePass123!',
          fullName: 'Duplicate',
          role: UserRole.SECRETARY,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create user and return without sensitive fields', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'new@horizonpm.com',
        password: 'SecurePass123!',
        fullName: 'New User',
        role: UserRole.SECRETARY,
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should update user and return sanitized result', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, fullName: 'Updated Name' });

      const result = await service.update('user-uuid', { fullName: 'Updated Name' });
      expect(result.fullName).toBe('Updated Name');
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.update('nonexistent', { fullName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should deactivate user (isActive = false)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, isActive: false });

      const result = await service.remove('user-uuid');
      expect(result.isActive).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { isActive: false },
      });
    });
  });
});

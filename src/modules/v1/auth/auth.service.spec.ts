import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../database/prisma.service';
import { AuthService } from './auth.service';

const prisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  refreshToken: {
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const activeUser = {
  id: 'user-1',
  email: 'manager@horizonpm.com',
  role: 'MANAGER',
  isActive: true,
  passwordHash: 'hash',
};

describe('AuthService — multi-device sessions', () => {
  let service: AuthService;
  let jwtService: { signAsync: jest.Mock; decode: jest.Mock };

  beforeEach(async () => {
    jest.resetAllMocks();

    // Every issued token is distinct so we can tell sessions apart.
    let issued = 0;
    jwtService = {
      signAsync: jest.fn().mockImplementation(() => Promise.resolve(`token-${++issued}`)),
      // One week out, matching JWT_REFRESH_EXPIRES_IN's default.
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 7 * 86400 }),
    };

    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.user.update.mockResolvedValue(activeUser);
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_k: string, fallback?: unknown) => fallback),
            getOrThrow: jest.fn(() => 'secret'),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.spyOn(argon2, 'hash').mockResolvedValue('argon-hash' as never);
    jest.spyOn(argon2, 'verify').mockResolvedValue(true as never);
  });

  describe('login', () => {
    it('creates a new session row per login instead of overwriting one token', async () => {
      // The reported bug: signing in on a second machine signed the first one out,
      // because both wrote to the single User.refreshTokenHash column.
      await service.login({ email: activeUser.email, password: 'pw' });
      await service.login({ email: activeUser.email, password: 'pw' });

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(2);

      const [first, second] = prisma.refreshToken.create.mock.calls;
      expect(first[0].data.id).not.toEqual(second[0].data.id);
      expect(first[0].data.userId).toBe('user-1');

      // Nothing about the first session is touched by the second login.
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('never writes the superseded single-token column', async () => {
      await service.login({ email: activeUser.email, password: 'pw' });

      for (const call of prisma.user.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('refreshTokenHash');
      }
    });

    it('records the session expiry from the token\'s own exp claim', async () => {
      await service.login({ email: activeUser.email, password: 'pw' });

      const { expiresAt } = prisma.refreshToken.create.mock.calls[0][0].data;
      const daysOut = (expiresAt.getTime() - Date.now()) / 86400000;
      expect(daysOut).toBeGreaterThan(6.9);
      expect(daysOut).toBeLessThan(7.1);
    });
  });

  describe('refresh', () => {
    it('rotates in place, leaving other sessions alone', async () => {
      await service.refresh('user-1', 'session-a');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-a', userId: 'user-1', revokedAt: null },
        }),
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('refuses when the session was revoked mid-flight', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh('user-1', 'session-a')).rejects.toThrow(ForbiddenException);
    });

    it('refuses for a deactivated user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });

      await expect(service.refresh('user-1', 'session-a')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('logout', () => {
    it('ends only the calling session', async () => {
      await service.logout('user-1', 'session-a');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null, id: 'session-a' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('ends every session when the token carries no session id', async () => {
      // Pre-upgrade tokens can't say which device asked, so err towards signing out.
      await service.logout('user-1', undefined);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('changePassword', () => {
    it('ends every session, not just the current one', async () => {
      prisma.$transaction.mockResolvedValue([]);

      await service.changePassword('user-1', {
        currentPassword: 'old',
        newPassword: 'NewPass123!',
      });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});

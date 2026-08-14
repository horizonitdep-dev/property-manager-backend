import { Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { LoginDto } from './dtos/login.dto';
import { ChangePasswordDto } from './dtos/change-password.dto';

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      return null;
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      this.logger.warn(`Failed login attempt for: ${email}`);
      return null;
    }

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // A fresh session id per login — this is what keeps devices independent.
    // Logging in here must not disturb any session already open elsewhere.
    const sid = randomUUID();
    const tokens = await this.generateTokens(user.id, user.email, user.role, sid);
    await this.createSession(sid, user.id, tokens.refreshToken);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.pruneExpiredSessions(user.id);

    this.logger.log(`User logged in: ${user.email}`, { userId: user.id, sid, action: 'LOGIN' });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  async refresh(userId: string, sid: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new ForbiddenException('Access denied');
    }

    // Rotate in place: the same session keeps its id, so the other devices'
    // rows are untouched and this device's old token stops working.
    const tokens = await this.generateTokens(user.id, user.email, user.role, sid);
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: sid, userId, revokedAt: null },
      data: {
        tokenHash: await argon2.hash(tokens.refreshToken, ARGON2_OPTIONS),
        expiresAt: this.refreshTokenExpiry(tokens.refreshToken),
      },
    });

    // Revoked between the guard's check and here (e.g. a logout landed mid-flight).
    if (count === 0) {
      throw new ForbiddenException('Access denied');
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /** Ends only the session the caller is using; other devices stay signed in. */
  async logout(userId: string, sid?: string) {
    const { count } = await this.prisma.refreshToken.updateMany({
      // Without a sid (a token predating multi-session support) there's no way to
      // tell which device asked, so end them all rather than silently none.
      where: { userId, revokedAt: null, ...(sid ? { id: sid } : {}) },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`User logged out`, { userId, sid, sessionsEnded: count, action: 'LOGOUT' });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.sanitizeUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!passwordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      // Deliberately every session, not just this one — a password change is the
      // lever for "someone else may have my account", so all devices sign out.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log(`Password changed`, { userId, action: 'CHANGE_PASSWORD' });
  }

  private async generateTokens(userId: string, email: string, role: string, sid: string) {
    const payload = { sub: userId, email, role, sid };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async createSession(sid: string, userId: string, refreshToken: string) {
    await this.prisma.refreshToken.create({
      data: {
        id: sid,
        userId,
        tokenHash: await argon2.hash(refreshToken, ARGON2_OPTIONS),
        expiresAt: this.refreshTokenExpiry(refreshToken),
      },
    });
  }

  /**
   * The session row's expiry, read from the token's own `exp` claim rather than
   * re-deriving it from JWT_REFRESH_EXPIRES_IN — that way the row can never
   * outlive (or die before) the token it represents if the setting is changed.
   */
  private refreshTokenExpiry(refreshToken: string): Date {
    const decoded = this.jwtService.decode(refreshToken) as { exp?: number } | null;
    if (!decoded?.exp) {
      throw new Error('Refresh token has no exp claim — cannot record session expiry');
    }
    return new Date(decoded.exp * 1000);
  }

  /** Housekeeping so a long-lived account doesn't accumulate dead session rows.
   * Only ever removes sessions that are already unusable. */
  private async pruneExpiredSessions(userId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, OR: [{ expiresAt: { lte: new Date() } }, { revokedAt: { not: null } }] },
    });
  }

  sanitizeUser(user: User) {
    const { passwordHash, refreshTokenHash, ...safe } = user;
    void passwordHash;
    void refreshTokenHash;
    return safe;
  }
}

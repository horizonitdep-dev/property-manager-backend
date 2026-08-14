import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../database/prisma.service';
import * as argon2 from 'argon2';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string; sid?: string }) {
    const refreshToken = req.body?.refreshToken as string | undefined;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not provided');
    }

    // Tokens issued before the multi-session change carry no sid and have no row
    // to match, so they can't be honoured — the holder just logs in again once.
    if (!payload.sid) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Access denied');
    }

    // Look the session up by its own id rather than scanning every session this
    // user has: argon2 hashes are salted, so matching without the id would mean
    // one deliberately-slow verify per active device on every refresh.
    const session = await this.prisma.refreshToken.findUnique({ where: { id: payload.sid } });
    if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const tokenMatches = await argon2.verify(session.tokenHash, refreshToken);
    if (!tokenMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return { ...user, sid: session.id, refreshToken };
  }
}

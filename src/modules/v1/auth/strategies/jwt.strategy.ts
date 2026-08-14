import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Session id — the RefreshToken row this token was issued against. Lets a
   * logout end only the device it was called from, and a refresh find its own
   * session directly. Optional so access tokens issued before the multi-session
   * change still validate; those simply can't do per-device logout. */
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // sid rides along so @CurrentUser('sid') can tell logout which session to end.
    return { ...user, sid: payload.sid };
  }
}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './database/prisma.module';
import { LoggerModule } from './shared/logger/logger.module';
import { AuthModule } from './modules/v1/auth/auth.module';
import { UsersModule } from './modules/v1/users/users.module';
import { BuildingsModule } from './modules/v1/buildings/buildings.module';
import { PropertiesModule } from './modules/v1/properties/properties.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),
    LoggerModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    BuildingsModule,
    PropertiesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

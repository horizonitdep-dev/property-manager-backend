import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as winston from 'winston';

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'authorization',
  'emiratesIdNumber',
  'passportNumber',
  'tradeLicenseNumber',
];

const redactSensitive = winston.format((info) => {
  SENSITIVE_KEYS.forEach((key) => {
    if (key in (info as Record<string, unknown>)) {
      (info as Record<string, unknown>)[key] = '[REDACTED]';
    }
  });
  return info;
});

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        level: config.get<string>('LOG_LEVEL', 'info'),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          redactSensitive(),
          winston.format.json(),
        ),
        transports: [
          new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
          }),
        ],
      }),
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}

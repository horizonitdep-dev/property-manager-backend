import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Security headers
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', 'http://localhost:3001'),
    credentials: true,
  });

  // Global API prefix
  app.setGlobalPrefix(configService.get<string>('API_PREFIX', 'api'));

  // URI versioning — defaultVersion means unversioned controllers get /v1
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe());

  // Standard response envelope
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Error handling — Prisma filter first so it catches DB errors before the generic filter
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Horizon Property Manager API')
    .setDescription('Backend API for Horizon Property Manager')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('Authentication')
    .addTag('Users')
    .addTag('Buildings')
    .addTag('Properties')
    .addTag('Tenants')
    .addTag('Contracts')
    .addTag('Health')
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://api.horizonpm.com', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  console.log(`Application running on: http://localhost:${port}/api/v1`);
  console.log(`Swagger docs:           http://localhost:${port}/api/docs`);
  console.log(`Health check:           http://localhost:${port}/api/health`);
}

bootstrap();

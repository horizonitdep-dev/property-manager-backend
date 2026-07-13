import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

/**
 * E2E tests for Buildings endpoints.
 * Requires a running PostgreSQL database with seed data.
 */
describe('BuildingsController (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let secretaryToken: string;
  let createdBuildingId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());
    await app.init();

    // Login as manager
    const managerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: process.env.SEED_MANAGER_EMAIL ?? 'manager@horizonpm.com',
        password: process.env.SEED_MANAGER_PASSWORD ?? 'ChangeMe123!',
      });
    if (managerRes.status === 200) {
      managerToken = managerRes.body.data.accessToken as string;
    }

    // Login as secretary
    const secretaryRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: process.env.SEED_SECRETARY_EMAIL ?? 'secretary@horizonpm.com',
        password: process.env.SEED_SECRETARY_PASSWORD ?? 'ChangeMe123!',
      });
    if (secretaryRes.status === 200) {
      secretaryToken = secretaryRes.body.data.accessToken as string;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/buildings (list)', () => {
    it('should return 401 for unauthenticated request', () => {
      return request(app.getHttpServer()).get('/api/v1/buildings').expect(401);
    });

    it('should return paginated buildings for Manager', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.items).toBeDefined();
          expect(res.body.data.meta).toBeDefined();
          expect(res.body.data.meta.page).toBe(1);
        });
    });

    it('should return buildings for Secretary (read-only)', async () => {
      if (!secretaryToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/buildings')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);
    });
  });

  describe('POST /api/v1/buildings (create)', () => {
    const newBuilding = {
      name: 'Test Tower E2E',
      code: 'E2E-001',
      address: '123 Test Street, Abu Dhabi',
      city: 'Abu Dhabi',
      buildingType: 'RESIDENTIAL',
      totalFloors: 5,
      yearBuilt: 2020,
      totalUnits: 40,
      constructionStatus: 'UNDER_CONSTRUCTION',
    };

    it('should return 403 when Secretary attempts to create', async () => {
      if (!secretaryToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send(newBuilding)
        .expect(403);
    });

    it('should create building for Manager', async () => {
      if (!managerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(newBuilding);

      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.code).toBe('E2E-001');
        expect(res.body.data.totalUnits).toBe(40);
        expect(res.body.data.constructionStatus).toBe('UNDER_CONSTRUCTION');
        createdBuildingId = res.body.data.id as string;
      }
    });

    it('should default constructionStatus to COMPLETE when not provided', async () => {
      if (!managerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...newBuilding, code: 'E2E-002', constructionStatus: undefined });

      if (res.status === 201) {
        expect(res.body.data.constructionStatus).toBe('COMPLETE');
      }
    });

    it('should return 400 for totalUnits above maximum', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...newBuilding, code: 'E2E-003', totalUnits: 10001 })
        .expect(400);
    });

    it('should return 400 for invalid constructionStatus enum value', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...newBuilding, code: 'E2E-004', constructionStatus: 'DEMOLISHED' })
        .expect(400);
    });

    it('should return 409 for duplicate building code', async () => {
      if (!managerToken || !createdBuildingId) return;

      return request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send(newBuilding)
        .expect(409);
    });

    it('should return 400 for invalid DTO (invalid code format)', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ ...newBuilding, code: 'invalid code!', name: 'Other' })
        .expect(400);
    });
  });

  describe('GET /api/v1/buildings/:id', () => {
    it('should return 404 for nonexistent building', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/buildings/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });

    it('should return building by ID', async () => {
      if (!managerToken || !createdBuildingId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/buildings/${createdBuildingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.id).toBe(createdBuildingId);
        });
    });
  });

  describe('PATCH /api/v1/buildings/:id', () => {
    it('should update building for Manager', async () => {
      if (!managerToken || !createdBuildingId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/buildings/${createdBuildingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Updated E2E Tower' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.name).toBe('Updated E2E Tower');
        });
    });
  });

  describe('DELETE /api/v1/buildings/:id (soft delete)', () => {
    it('should soft delete building for Manager', async () => {
      if (!managerToken || !createdBuildingId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/buildings/${createdBuildingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body.data.deletedAt).toBeDefined();
    });

    it('should return 404 for already-deleted building', async () => {
      if (!managerToken || !createdBuildingId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/buildings/${createdBuildingId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });
});

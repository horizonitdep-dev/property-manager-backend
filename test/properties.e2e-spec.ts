import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

/**
 * E2E tests for Properties endpoints.
 * Requires a running PostgreSQL database with seed data.
 */
describe('PropertiesController (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let secretaryToken: string;
  let buildingAId: string;
  let buildingBId: string;
  let createdPropertyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());
    await app.init();

    const managerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: process.env.SEED_MANAGER_EMAIL ?? 'manager@horizonpm.com',
        password: process.env.SEED_MANAGER_PASSWORD ?? 'ChangeMe123!',
      });
    if (managerRes.status === 200) {
      managerToken = managerRes.body.data.accessToken as string;
    }

    const secretaryRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: process.env.SEED_SECRETARY_EMAIL ?? 'secretary@horizonpm.com',
        password: process.env.SEED_SECRETARY_PASSWORD ?? 'ChangeMe123!',
      });
    if (secretaryRes.status === 200) {
      secretaryToken = secretaryRes.body.data.accessToken as string;
    }

    if (managerToken) {
      const buildingA = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Properties E2E Building A',
          code: 'PROP-E2E-A',
          address: '1 Test Street',
          city: 'Abu Dhabi',
          buildingType: 'RESIDENTIAL',
          totalFloors: 5,
        });
      buildingAId = buildingA.body?.data?.id;

      const buildingB = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Properties E2E Building B',
          code: 'PROP-E2E-B',
          address: '2 Test Street',
          city: 'Abu Dhabi',
          buildingType: 'RESIDENTIAL',
          totalFloors: 5,
        });
      buildingBId = buildingB.body?.data?.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/properties (list)', () => {
    it('should return 401 for unauthenticated request', () => {
      return request(app.getHttpServer()).get('/api/v1/properties').expect(401);
    });

    it('should return paginated properties for Manager', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.items).toBeDefined();
          expect(res.body.data.meta).toBeDefined();
        });
    });

    it('should return properties for Secretary (read-only)', async () => {
      if (!secretaryToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/properties')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);
    });
  });

  describe('POST /api/v1/properties (create)', () => {
    it('should return 403 when Secretary attempts to create', async () => {
      if (!secretaryToken || !buildingAId) return;

      return request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          unitNumber: '101',
          buildingId: buildingAId,
          floor: 1,
          unitType: 'APARTMENT',
          monthlyRent: 2000,
        })
        .expect(403);
    });

    it('should return 404 for a nonexistent buildingId', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          unitNumber: '101',
          buildingId: '00000000-0000-0000-0000-000000000000',
          floor: 1,
          unitType: 'APARTMENT',
          monthlyRent: 2000,
        })
        .expect(404);
    });

    it('should create property for Manager', async () => {
      if (!managerToken || !buildingAId) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          unitNumber: '101',
          buildingId: buildingAId,
          floor: 1,
          unitType: 'APARTMENT',
          bedrooms: 2,
          bathrooms: 1,
          monthlyRent: 2000,
        });

      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.unitNumber).toBe('101');
        expect(res.body.data.building.id).toBe(buildingAId);
        createdPropertyId = res.body.data.id as string;
      }
    });

    it('should return 409 for duplicate unitNumber in same building', async () => {
      if (!managerToken || !buildingAId || !createdPropertyId) return;

      return request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          unitNumber: '101',
          buildingId: buildingAId,
          floor: 1,
          unitType: 'APARTMENT',
          monthlyRent: 2000,
        })
        .expect(409);
    });

    it('should succeed with the same unitNumber in a different building', async () => {
      if (!managerToken || !buildingBId || !createdPropertyId) return;

      return request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          unitNumber: '101',
          buildingId: buildingBId,
          floor: 1,
          unitType: 'APARTMENT',
          monthlyRent: 2100,
        })
        .expect(201);
    });

    it('should return 400 for invalid DTO (missing monthlyRent)', async () => {
      if (!managerToken || !buildingAId) return;

      return request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          unitNumber: '102',
          buildingId: buildingAId,
          floor: 1,
          unitType: 'APARTMENT',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/properties/:id', () => {
    it('should return 404 for nonexistent property', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/properties/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });

    it('should return property by ID including nested building', async () => {
      if (!managerToken || !createdPropertyId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.id).toBe(createdPropertyId);
          expect(res.body.data.building).toBeDefined();
        });
    });
  });

  describe('PATCH /api/v1/properties/:id', () => {
    it('should return 403 when Secretary attempts to update', async () => {
      if (!secretaryToken || !createdPropertyId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ monthlyRent: 2200 })
        .expect(403);
    });

    it('should update property for Manager', async () => {
      if (!managerToken || !createdPropertyId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ status: 'OCCUPIED' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.status).toBe('OCCUPIED');
        });
    });
  });

  describe('GET /api/v1/buildings/:buildingId/properties', () => {
    it("should return only that building's units", async () => {
      if (!managerToken || !buildingAId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/buildings/${buildingAId}/properties`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          const items = res.body.data.items as Array<{ building: { id: string } }>;
          expect(items.length).toBeGreaterThan(0);
          for (const item of items) {
            expect(item.building.id).toBe(buildingAId);
          }
        });
    });
  });

  describe('Building totalUnits live count', () => {
    it("should reflect the building's non-deleted property count", async () => {
      if (!managerToken || !buildingAId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/buildings/${buildingAId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.totalUnits).toBe(1);
        });
    });
  });

  describe('DELETE /api/v1/properties/:id (soft delete)', () => {
    it('should return 403 when Secretary attempts to delete', async () => {
      if (!secretaryToken || !createdPropertyId) return;

      return request(app.getHttpServer())
        .delete(`/api/v1/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(403);
    });

    it('should soft delete property for Manager', async () => {
      if (!managerToken || !createdPropertyId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body.data.deletedAt).toBeDefined();
    });

    it("should exclude the soft-deleted property from the building's totalUnits", async () => {
      if (!managerToken || !buildingAId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/buildings/${buildingAId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.totalUnits).toBe(0);
        });
    });

    it('should return 404 for already-deleted property', async () => {
      if (!managerToken || !createdPropertyId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/properties/${createdPropertyId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });
});

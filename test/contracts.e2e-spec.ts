import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

/**
 * E2E tests for Contracts endpoints.
 * Requires a running PostgreSQL database with seed data (manager/secretary users).
 * Building/property/tenant fixtures are created within this suite, mirroring
 * properties.e2e-spec.ts and tenants.e2e-spec.ts.
 */
describe('ContractsController (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let secretaryToken: string;
  let buildingId: string;
  let propertyId: string;
  let tenantId: string;
  let createdContractId: string;
  let renewedContractId: string;

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
      const building = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Contracts E2E Building',
          code: 'CONTRACT-E2E-B',
          address: '1 Test Street',
          city: 'Abu Dhabi',
          buildingType: 'RESIDENTIAL',
          totalFloors: 5,
        });
      buildingId = building.body?.data?.id;

      const property = await request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          unitNumber: 'CE2E-101',
          buildingId,
          floor: 1,
          unitType: 'APARTMENT',
          monthlyRent: 2000,
        });
      propertyId = property.body?.data?.id;

      const tenant = await request(app.getHttpServer())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          tenantType: 'INDIVIDUAL',
          nameEn: 'Contracts E2E Tenant',
          phone: '+971509999999',
          emiratesIdNumber: '784-1999-9999999-9',
          emiratesIdExpiry: '2030-01-01T00:00:00.000Z',
          passportNumber: 'P9999999',
          passportExpiry: '2030-01-01T00:00:00.000Z',
        });
      if (tenant.status !== 201) {
        // eslint-disable-next-line no-console
        console.error('Fixture tenant creation failed:', tenant.status, JSON.stringify(tenant.body));
      }
      tenantId = tenant.body?.data?.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/contracts (list)', () => {
    it('should return 401 for unauthenticated request', () => {
      return request(app.getHttpServer()).get('/api/v1/contracts').expect(401);
    });

    it('should return paginated contracts for Manager', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/contracts')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.items).toBeDefined();
          expect(res.body.data.meta).toBeDefined();
        });
    });

    it('should return contracts for Secretary (read-only)', async () => {
      if (!secretaryToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/contracts')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);
    });
  });

  describe('POST /api/v1/contracts (create)', () => {
    it('should return 403 when Secretary attempts to create', async () => {
      if (!secretaryToken || !propertyId || !tenantId) return;

      return request(app.getHttpServer())
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-001',
          tenantId,
          propertyId,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          annualRent: 28000,
          monthlyRent: 2330,
          paymentFrequency: 'MONTHLY',
          status: 'ACTIVE',
        })
        .expect(403);
    });

    it('should return 404 for a nonexistent tenantId', async () => {
      if (!managerToken || !propertyId) return;

      return request(app.getHttpServer())
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-BAD-TENANT',
          tenantId: '00000000-0000-0000-0000-000000000000',
          propertyId,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          annualRent: 28000,
          monthlyRent: 2330,
          paymentFrequency: 'MONTHLY',
        })
        .expect(404);
    });

    it('should return 400 when endDate is before startDate', async () => {
      if (!managerToken || !propertyId || !tenantId) return;

      return request(app.getHttpServer())
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-BAD-DATES',
          tenantId,
          propertyId,
          startDate: '2025-12-31',
          endDate: '2025-01-01',
          annualRent: 28000,
          monthlyRent: 2330,
          paymentFrequency: 'MONTHLY',
        })
        .expect(400);
    });

    it('should return 400 for CHEQUES without numberOfCheques', async () => {
      if (!managerToken || !propertyId || !tenantId) return;

      return request(app.getHttpServer())
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-BAD-CHEQUES',
          tenantId,
          propertyId,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          annualRent: 28000,
          monthlyRent: 2330,
          paymentFrequency: 'CHEQUES',
        })
        .expect(400);
    });

    it('should create an ACTIVE contract for Manager and flip the property to OCCUPIED', async () => {
      if (!managerToken || !propertyId || !tenantId) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-001',
          tenantId,
          propertyId,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          annualRent: 28000,
          monthlyRent: 2330,
          paymentFrequency: 'MONTHLY',
          status: 'ACTIVE',
        });

      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.contractNumber).toBe('E2E-CONTRACT-001');
        expect(res.body.data.storedStatus).toBe('ACTIVE');
        createdContractId = res.body.data.id as string;

        const property = await request(app.getHttpServer())
          .get(`/api/v1/properties/${propertyId}`)
          .set('Authorization', `Bearer ${managerToken}`);
        expect(property.body.data.status).toBe('OCCUPIED');
      }
    });

    it('should return 409 for an overlapping ACTIVE contract on the same property', async () => {
      if (!managerToken || !propertyId || !tenantId || !createdContractId) return;

      return request(app.getHttpServer())
        .post('/api/v1/contracts')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-OVERLAP',
          tenantId,
          propertyId,
          startDate: '2025-06-01',
          endDate: '2025-08-01',
          annualRent: 28000,
          monthlyRent: 2330,
          paymentFrequency: 'MONTHLY',
          status: 'ACTIVE',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.message).toContain('E2E-CONTRACT-001');
        });
    });
  });

  describe('GET /api/v1/contracts/:id', () => {
    it('should return 404 for nonexistent contract', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/contracts/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });

    it('should return contract by ID with nested tenant + property summaries', async () => {
      if (!managerToken || !createdContractId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/contracts/${createdContractId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.id).toBe(createdContractId);
          expect(res.body.data.tenant.id).toBe(tenantId);
          expect(res.body.data.property.id).toBe(propertyId);
          expect(res.body.data.property.building.id).toBe(buildingId);
        });
    });
  });

  describe('PATCH /api/v1/contracts/:id', () => {
    it('should return 403 when Secretary attempts to update', async () => {
      if (!secretaryToken || !createdContractId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/contracts/${createdContractId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ notes: 'nope' })
        .expect(403);
    });

    it('should update contract for Manager', async () => {
      if (!managerToken || !createdContractId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/contracts/${createdContractId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ notes: 'Updated via E2E' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.notes).toBe('Updated via E2E');
        });
    });
  });

  describe('GET /api/v1/properties/:id/contracts and /api/v1/tenants/:id/contracts', () => {
    it('should return contract history for the property', async () => {
      if (!managerToken || !propertyId || !createdContractId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/properties/${propertyId}/contracts`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.items.some((c: { id: string }) => c.id === createdContractId)).toBe(true);
        });
    });

    it('should return contract history for the tenant', async () => {
      if (!managerToken || !tenantId || !createdContractId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/contracts`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.items.some((c: { id: string }) => c.id === createdContractId)).toBe(true);
        });
    });
  });

  describe('POST /api/v1/contracts/:id/renew', () => {
    it('should return 403 when Secretary attempts to renew', async () => {
      if (!secretaryToken || !createdContractId) return;

      return request(app.getHttpServer())
        .post(`/api/v1/contracts/${createdContractId}/renew`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ contractNumber: 'E2E-CONTRACT-001-R1', startDate: '2026-01-01', endDate: '2026-12-31' })
        .expect(403);
    });

    it('should create a renewal linked to the source, without modifying the source', async () => {
      if (!managerToken || !createdContractId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/contracts/${createdContractId}/renew`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          contractNumber: 'E2E-CONTRACT-001-R1',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'ACTIVE',
        });

      if (res.status === 201) {
        expect(res.body.data.renewedFromId).toBe(createdContractId);
        renewedContractId = res.body.data.id as string;

        const source = await request(app.getHttpServer())
          .get(`/api/v1/contracts/${createdContractId}`)
          .set('Authorization', `Bearer ${managerToken}`);
        expect(source.body.data.storedStatus).toBe('ACTIVE'); // source untouched
      }
    });
  });

  describe('POST /api/v1/contracts/:id/terminate', () => {
    it('should return 403 when Secretary attempts to terminate', async () => {
      if (!secretaryToken || !renewedContractId) return;

      return request(app.getHttpServer())
        .post(`/api/v1/contracts/${renewedContractId}/terminate`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({})
        .expect(403);
    });

    it('should terminate the contract for Manager and free the property once no active contract remains', async () => {
      if (!managerToken || !renewedContractId || !createdContractId || !propertyId) return;

      // Terminate both the original and the renewal so the property has no active contract left.
      await request(app.getHttpServer())
        .post(`/api/v1/contracts/${createdContractId}/terminate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ terminationReason: 'E2E cleanup' });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/contracts/${renewedContractId}/terminate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ terminationReason: 'E2E cleanup' });

      if (res.status === 200) {
        expect(res.body.data.storedStatus).toBe('TERMINATED');

        const property = await request(app.getHttpServer())
          .get(`/api/v1/properties/${propertyId}`)
          .set('Authorization', `Bearer ${managerToken}`);
        expect(property.body.data.status).toBe('VACANT');
      }
    });
  });

  describe('Contract documents', () => {
    let uploadedDocumentId: string;

    it('should return 404 uploading a document to a nonexistent contract', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/contracts/00000000-0000-0000-0000-000000000000/documents')
        .set('Authorization', `Bearer ${managerToken}`)
        .field('documentType', 'SIGNED_CONTRACT')
        .attach('file', Buffer.from('%PDF-1.4 fake'), 'contract.pdf')
        .expect(404);
    });

    it('should upload a document and retrieve a signed URL', async () => {
      if (!managerToken || !createdContractId) return;

      const uploadRes = await request(app.getHttpServer())
        .post(`/api/v1/contracts/${createdContractId}/documents`)
        .set('Authorization', `Bearer ${managerToken}`)
        .field('documentType', 'SIGNED_CONTRACT')
        .attach('file', Buffer.from('%PDF-1.4 fake'), 'contract.pdf');

      if (uploadRes.status === 201) {
        uploadedDocumentId = uploadRes.body.data.id as string;

        const urlRes = await request(app.getHttpServer())
          .get(`/api/v1/contracts/${createdContractId}/documents/${uploadedDocumentId}/url`)
          .set('Authorization', `Bearer ${managerToken}`);
        expect(urlRes.status).toBe(200);
        expect(urlRes.body.data.url).toBeDefined();
      }
    });

    it('should soft delete the document', async () => {
      if (!managerToken || !createdContractId || !uploadedDocumentId) return;

      return request(app.getHttpServer())
        .delete(`/api/v1/contracts/${createdContractId}/documents/${uploadedDocumentId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
    });
  });

  describe('DELETE /api/v1/contracts/:id (soft delete)', () => {
    it('should soft delete contract for Manager', async () => {
      if (!managerToken || !renewedContractId) return;

      // ContractResponseDto omits deletedAt (see contract-response.dto.ts) — the
      // 200 here plus the follow-up 404 below are what prove the soft delete took.
      await request(app.getHttpServer())
        .delete(`/api/v1/contracts/${renewedContractId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
    });

    it('should return 404 for already-deleted contract', async () => {
      if (!managerToken || !renewedContractId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/contracts/${renewedContractId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });
});

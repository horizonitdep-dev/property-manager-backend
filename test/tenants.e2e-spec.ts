import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

/**
 * E2E tests for Tenants endpoints.
 * Requires a running PostgreSQL database with seed data and real storage
 * credentials (STORAGE_*) configured — the upload test is skipped if the
 * server isn't reachable / auth fails, mirroring properties.e2e-spec.ts.
 */
describe('TenantsController (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let secretaryToken: string;
  let createdIndividualId: string;
  let createdCompanyId: string;
  let uploadedDocumentId: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/tenants (list)', () => {
    it('should return 401 for unauthenticated request', () => {
      return request(app.getHttpServer()).get('/api/v1/tenants').expect(401);
    });

    it('should return paginated tenants for Manager', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.items).toBeDefined();
          expect(res.body.data.meta).toBeDefined();
        });
    });

    it('should return 200 for Secretary (read-only)', async () => {
      if (!secretaryToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/tenants')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);
    });

    it('should omit ID/licence numbers from list items', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          const items = res.body.data.items as Record<string, unknown>[];
          for (const item of items) {
            expect(item).not.toHaveProperty('emiratesIdNumber');
            expect(item).not.toHaveProperty('passportNumber');
            expect(item).not.toHaveProperty('tradeLicenseNumber');
          }
        });
    });
  });

  describe('POST /api/v1/tenants (create)', () => {
    it('should return 403 when Secretary attempts to create', async () => {
      if (!secretaryToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          tenantType: 'INDIVIDUAL',
          nameEn: 'Test Tenant',
          phone: '+971501112233',
          emiratesIdNumber: '784-1111',
          emiratesIdExpiry: '2027-01-01',
          passportNumber: 'P111',
          passportExpiry: '2028-01-01',
        })
        .expect(403);
    });

    it('should return 400 when INDIVIDUAL is missing Emirates ID fields', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          tenantType: 'INDIVIDUAL',
          nameEn: 'Incomplete Tenant',
          phone: '+971501112244',
        })
        .expect(400);
    });

    it('should create an INDIVIDUAL tenant for Manager', async () => {
      if (!managerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          tenantType: 'INDIVIDUAL',
          nameEn: 'E2E Individual Tenant',
          nameAr: 'مستأجر تجريبي',
          phone: '+971501112255',
          emiratesIdNumber: '784-2222',
          emiratesIdExpiry: '2027-01-01',
          passportNumber: 'P222',
          passportExpiry: '2028-01-01',
        });

      if (res.status === 201) {
        expect(res.body.data.nameEn).toBe('E2E Individual Tenant');
        expect(res.body.data.emiratesIdNumber).toBe('784-2222');
        createdIndividualId = res.body.data.id as string;
      }
    });

    it('should return 400 when COMPANY is missing trade licence fields', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          tenantType: 'COMPANY',
          nameEn: 'Incomplete Company',
          phone: '+97121112233',
        })
        .expect(400);
    });

    it('should create a COMPANY tenant for Manager', async () => {
      if (!managerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          tenantType: 'COMPANY',
          nameEn: 'E2E Trading LLC',
          phone: '+97121112244',
          tradeLicenseNumber: 'CN-999999',
          tradeLicenseExpiry: '2026-01-01',
          authorizedPersonNameEn: 'Test Authorized Person',
          authorizedPersonOccupation: 'Manager',
        });

      if (res.status === 201) {
        expect(res.body.data.nameEn).toBe('E2E Trading LLC');
        createdCompanyId = res.body.data.id as string;
      }
    });
  });

  describe('GET /api/v1/tenants/:id', () => {
    it('should return 404 for nonexistent tenant', async () => {
      if (!managerToken) return;

      return request(app.getHttpServer())
        .get('/api/v1/tenants/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });

    it('should return full detail including ID numbers and documents array', async () => {
      if (!managerToken || !createdIndividualId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${createdIndividualId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.id).toBe(createdIndividualId);
          expect(res.body.data.emiratesIdNumber).toBeDefined();
          expect(res.body.data.documents).toBeDefined();
        });
    });
  });

  describe('PATCH /api/v1/tenants/:id', () => {
    it('should return 403 when Secretary attempts to update', async () => {
      if (!secretaryToken || !createdIndividualId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/tenants/${createdIndividualId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ notes: 'not allowed' })
        .expect(403);
    });

    it('should update tenant for Manager', async () => {
      if (!managerToken || !createdIndividualId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/tenants/${createdIndividualId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ status: 'FORMER' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.status).toBe('FORMER');
        });
    });

    it('should return 400 when switching to COMPANY without the required fields', async () => {
      if (!managerToken || !createdIndividualId) return;

      return request(app.getHttpServer())
        .patch(`/api/v1/tenants/${createdIndividualId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ tenantType: 'COMPANY' })
        .expect(400);
    });
  });

  describe('Document upload + signed URL flow', () => {
    it('should return 400 for a disallowed file type', async () => {
      if (!managerToken || !createdIndividualId) return;

      return request(app.getHttpServer())
        .post(`/api/v1/tenants/${createdIndividualId}/documents`)
        .set('Authorization', `Bearer ${managerToken}`)
        .field('documentType', 'EMIRATES_ID')
        .attach('file', Buffer.from('not a real file'), {
          filename: 'malware.exe',
          contentType: 'application/octet-stream',
        })
        .expect(400);
    });

    it('should upload a valid PDF document for Manager', async () => {
      if (!managerToken || !createdIndividualId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/tenants/${createdIndividualId}/documents`)
        .set('Authorization', `Bearer ${managerToken}`)
        .field('documentType', 'EMIRATES_ID')
        .attach('file', Buffer.from('%PDF-1.4 fake pdf content for e2e test'), {
          filename: 'emirates-id.pdf',
          contentType: 'application/pdf',
        });

      if (res.status === 201) {
        expect(res.body.data.documentType).toBe('EMIRATES_ID');
        uploadedDocumentId = res.body.data.id as string;
      }
    });

    it('should list document metadata for the tenant', async () => {
      if (!managerToken || !createdIndividualId || !uploadedDocumentId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${createdIndividualId}/documents`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          const docs = res.body.data as Record<string, unknown>[];
          expect(docs.some((d) => d.id === uploadedDocumentId)).toBe(true);
        });
    });

    it('should return a signed download URL', async () => {
      if (!managerToken || !createdIndividualId || !uploadedDocumentId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${createdIndividualId}/documents/${uploadedDocumentId}/url`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.url).toBeDefined();
          expect(res.body.data.expiresInSeconds).toBe(300);
        });
    });

    it('should return 404 for a document under a different tenant', async () => {
      if (!managerToken || !createdCompanyId || !uploadedDocumentId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${createdCompanyId}/documents/${uploadedDocumentId}/url`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });

    it('should soft delete the document for Manager', async () => {
      if (!managerToken || !createdIndividualId || !uploadedDocumentId) return;

      await request(app.getHttpServer())
        .delete(`/api/v1/tenants/${createdIndividualId}/documents/${uploadedDocumentId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${createdIndividualId}/documents`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200)
        .expect((res) => {
          const docs = res.body.data as Record<string, unknown>[];
          expect(docs.some((d) => d.id === uploadedDocumentId)).toBe(false);
        });
    });
  });

  describe('DELETE /api/v1/tenants/:id (soft delete)', () => {
    it('should return 403 when Secretary attempts to delete', async () => {
      if (!secretaryToken || !createdCompanyId) return;

      return request(app.getHttpServer())
        .delete(`/api/v1/tenants/${createdCompanyId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(403);
    });

    it('should soft delete tenant for Manager', async () => {
      if (!managerToken || !createdCompanyId) return;

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/tenants/${createdCompanyId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body.data.deletedAt).toBeDefined();
    });

    it('should return 404 for an already-deleted tenant', async () => {
      if (!managerToken || !createdCompanyId) return;

      return request(app.getHttpServer())
        .get(`/api/v1/tenants/${createdCompanyId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(404);
    });
  });
});

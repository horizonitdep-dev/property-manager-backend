import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantDocumentsService } from './tenant-documents.service';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../../shared/storage/storage.service';
import { TenantsService } from './tenants.service';
import { DocumentType } from '../../../common/enums/document-type.enum';

jest.mock('file-type', () => ({ fromBuffer: jest.fn() }));

import { fromBuffer } from 'file-type';

function mockFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'emirates-id.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake content'),
    size: 1024,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

describe('TenantDocumentsService', () => {
  let service: TenantDocumentsService;
  let prisma: {
    tenantDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let storage: { uploadFile: jest.Mock; getSignedUrl: jest.Mock; deleteFile: jest.Mock };
  let tenantsService: { ensureTenantExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tenantDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    storage = { uploadFile: jest.fn(), getSignedUrl: jest.fn(), deleteFile: jest.fn() };
    tenantsService = { ensureTenantExists: jest.fn().mockResolvedValue({ id: 'tenant-uuid' }) };

    (fromBuffer as jest.Mock).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantDocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: TenantsService, useValue: tenantsService },
      ],
    }).compile();

    service = module.get<TenantDocumentsService>(TenantDocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload', () => {
    it('should reject a disallowed MIME type detected from file content', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/x-msdownload', ext: 'exe' });

      await expect(
        service.upload('tenant-uuid', DocumentType.EMIRATES_ID, mockFile(), 'user-uuid'),
      ).rejects.toThrow(BadRequestException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('should reject a file over the 10 MB limit', async () => {
      await expect(
        service.upload(
          'tenant-uuid',
          DocumentType.EMIRATES_ID,
          mockFile({ size: 11 * 1024 * 1024 }),
          'user-uuid',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('should upload a valid PDF and persist metadata', async () => {
      (fromBuffer as jest.Mock).mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      storage.uploadFile.mockResolvedValue('tenants/tenant-uuid/EMIRATES_ID/file.pdf');
      prisma.tenantDocument.create.mockResolvedValue({
        id: 'doc-uuid',
        tenantId: 'tenant-uuid',
        documentType: DocumentType.EMIRATES_ID,
        fileName: 'emirates-id.pdf',
        fileKey: 'tenants/tenant-uuid/EMIRATES_ID/file.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      });

      const result = await service.upload(
        'tenant-uuid',
        DocumentType.EMIRATES_ID,
        mockFile(),
        'user-uuid',
      );

      expect(result.id).toBe('doc-uuid');
      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringContaining('tenants/tenant-uuid/EMIRATES_ID/'),
        expect.any(Buffer),
        'application/pdf',
      );
    });
  });

  describe('ownership checks', () => {
    it("should 404 rather than reveal another tenant's document", async () => {
      prisma.tenantDocument.findFirst.mockResolvedValue(null);

      await expect(service.getSignedUrl('tenant-uuid', 'doc-from-other-tenant')).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('should generate a signed URL for a document owned by this tenant', async () => {
      prisma.tenantDocument.findFirst.mockResolvedValue({
        id: 'doc-uuid',
        fileKey: 'tenants/t/x/file.pdf',
      });
      storage.getSignedUrl.mockResolvedValue('https://signed.example.com/file.pdf');

      const result = await service.getSignedUrl('tenant-uuid', 'doc-uuid');
      expect(result.url).toBe('https://signed.example.com/file.pdf');
      expect(result.expiresInSeconds).toBe(300);
    });
  });
});

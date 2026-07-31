import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { fromBuffer } from 'file-type';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../../shared/storage/storage.service';
import { TenantsService } from './tenants.service';
import { DocumentType } from '../../../common/enums/document-type.enum';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const SIGNED_URL_EXPIRY_SECONDS = 300;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class TenantDocumentsService {
  private readonly logger = new Logger(TenantDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenantsService: TenantsService,
  ) {}

  async upload(
    tenantId: string,
    documentType: DocumentType,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    await this.tenantsService.ensureTenantExists(tenantId);

    if (!file) {
      throw new BadRequestException('file is required');
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 10 MB size limit');
    }

    // Sniff the real MIME type from file content — never trust the client-supplied header alone.
    const detected = await fromBuffer(file.buffer);
    const actualMimeType = detected?.mime ?? file.mimetype;

    if (!ALLOWED_MIME_TYPES.includes(actualMimeType)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    const key = `tenants/${tenantId}/${documentType}/${randomUUID()}-${sanitizeFileName(file.originalname)}`;
    await this.storage.uploadFile(key, file.buffer, actualMimeType);

    const document = await this.prisma.tenantDocument.create({
      data: {
        tenantId,
        documentType,
        fileName: file.originalname,
        fileKey: key,
        fileSize: file.size,
        mimeType: actualMimeType,
        uploadedById: userId,
      },
    });

    this.logger.log('Tenant document uploaded', {
      tenantId,
      documentId: document.id,
      documentType,
      userId,
      action: 'UPLOAD_TENANT_DOCUMENT',
    });

    return document;
  }

  async findAllForTenant(tenantId: string) {
    await this.tenantsService.ensureTenantExists(tenantId);

    return this.prisma.tenantDocument.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getSignedUrl(tenantId: string, documentId: string) {
    const document = await this.findOwnedDocument(tenantId, documentId);
    const url = await this.storage.getSignedUrl(document.fileKey, SIGNED_URL_EXPIRY_SECONDS);
    return { url, expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS };
  }

  async remove(tenantId: string, documentId: string, userId: string) {
    const document = await this.findOwnedDocument(tenantId, documentId);

    // Retention policy is undecided — soft delete only, never remove from the bucket.
    const updated = await this.prisma.tenantDocument.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });

    this.logger.log('Tenant document soft deleted', {
      tenantId,
      documentId,
      userId,
      action: 'DELETE_TENANT_DOCUMENT',
    });

    return updated;
  }

  /** 404s if the document doesn't exist OR belongs to a different tenant — never leaks ownership. */
  private async findOwnedDocument(tenantId: string, documentId: string) {
    await this.tenantsService.ensureTenantExists(tenantId);

    const document = await this.prisma.tenantDocument.findFirst({
      where: { id: documentId, tenantId, deletedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }
}

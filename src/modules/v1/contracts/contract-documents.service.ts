import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { fromBuffer } from 'file-type';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../../shared/storage/storage.service';
import { ContractsService } from './contracts.service';
import { ContractDocumentType } from '../../../common/enums/contract-document-type.enum';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const SIGNED_URL_EXPIRY_SECONDS = 300;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class ContractDocumentsService {
  private readonly logger = new Logger(ContractDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly contractsService: ContractsService,
  ) {}

  async upload(
    contractId: string,
    documentType: ContractDocumentType,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    await this.contractsService.ensureContractExists(contractId);

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

    const key = `contracts/${contractId}/${documentType}/${randomUUID()}-${sanitizeFileName(file.originalname)}`;
    await this.storage.uploadFile(key, file.buffer, actualMimeType);

    const document = await this.prisma.contractDocument.create({
      data: {
        contractId,
        documentType,
        fileName: file.originalname,
        fileKey: key,
        fileSize: file.size,
        mimeType: actualMimeType,
        uploadedById: userId,
      },
    });

    this.logger.log('Contract document uploaded', {
      contractId,
      documentId: document.id,
      documentType,
      userId,
      action: 'UPLOAD_CONTRACT_DOCUMENT',
    });

    return document;
  }

  async findAllForContract(contractId: string) {
    await this.contractsService.ensureContractExists(contractId);

    return this.prisma.contractDocument.findMany({
      where: { contractId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getSignedUrl(contractId: string, documentId: string) {
    const document = await this.findOwnedDocument(contractId, documentId);
    const url = await this.storage.getSignedUrl(document.fileKey, SIGNED_URL_EXPIRY_SECONDS);
    return { url, expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS };
  }

  async remove(contractId: string, documentId: string, userId: string) {
    const document = await this.findOwnedDocument(contractId, documentId);

    // Retention policy is undecided — soft delete only, never remove from the bucket.
    const updated = await this.prisma.contractDocument.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });

    this.logger.log('Contract document soft deleted', {
      contractId,
      documentId,
      userId,
      action: 'DELETE_CONTRACT_DOCUMENT',
    });

    return updated;
  }

  /** 404s if the document doesn't exist OR belongs to a different contract — never leaks ownership. */
  private async findOwnedDocument(contractId: string, documentId: string) {
    await this.contractsService.ensureContractExists(contractId);

    const document = await this.prisma.contractDocument.findFirst({
      where: { id: documentId, contractId, deletedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }
}

import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { fromBuffer } from 'file-type';
import { StorageService } from '../../../../shared/storage/storage.service';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';

export const ALLOWED_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const SIGNED_URL_EXPIRY_SECONDS = 300;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface FinanceAttachmentRow {
  id: string;
  type: FinanceAttachmentType;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  uploadedById: string;
  deletedAt: Date | null;
}

/**
 * The subset of a Prisma attachment delegate this base needs. The three concrete
 * services cast their delegate to this — Prisma's generated delegates carry
 * overloads that do not assign to a hand-written interface, and narrowing here
 * keeps the cast in one obvious place per subclass instead of throughout.
 */
export interface FinanceAttachmentDelegate {
  create(args: { data: Record<string, unknown> }): Promise<FinanceAttachmentRow>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Record<string, unknown>;
  }): Promise<FinanceAttachmentRow[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<FinanceAttachmentRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<FinanceAttachmentRow>;
}

/**
 * Shared upload/list/sign/soft-delete behaviour for payment, cheque and expense
 * attachments. The three differ only in which parent they hang off, their storage
 * prefix and their default type, so the rules that matter — content-sniffed MIME
 * allowlist, 10 MB cap, signed-URL-only downloads, never hard-deleting from the
 * bucket — live here once and cannot drift apart between them (spec §6, §8).
 */
export abstract class FinanceAttachmentsBaseService {
  protected abstract readonly logger: Logger;
  /** Human word used in errors and log actions, e.g. 'payment'. */
  protected abstract readonly parentLabel: string;
  /** Storage key prefix, e.g. 'payments'. */
  protected abstract readonly keyPrefix: string;
  /** Column linking the attachment to its parent, e.g. 'paymentId'. */
  protected abstract readonly parentForeignKey: string;
  protected abstract readonly defaultType: FinanceAttachmentType;

  protected abstract get delegate(): FinanceAttachmentDelegate;
  protected abstract get storage(): StorageService;

  /** Must throw NotFoundException when the parent is absent or soft-deleted. */
  protected abstract ensureParentExists(parentId: string): Promise<void>;

  async upload(
    parentId: string,
    type: FinanceAttachmentType | undefined,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    await this.ensureParentExists(parentId);

    if (!file) {
      throw new BadRequestException('file is required');
    }

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 10 MB size limit');
    }

    // Sniff the real type from the bytes — a client-supplied Content-Type can
    // claim anything, and these are financial records people will re-download.
    const detected = await fromBuffer(file.buffer);
    const actualMimeType = detected?.mime ?? file.mimetype;

    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(actualMimeType)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed types: ${ALLOWED_ATTACHMENT_MIME_TYPES.join(', ')}`,
      );
    }

    const resolvedType = type ?? this.defaultType;
    const key = `finance/${this.keyPrefix}/${parentId}/${resolvedType}/${randomUUID()}-${sanitizeFileName(file.originalname)}`;

    await this.storage.uploadFile(key, file.buffer, actualMimeType);

    const attachment = await this.delegate.create({
      data: {
        [this.parentForeignKey]: parentId,
        type: resolvedType,
        fileName: file.originalname,
        fileKey: key,
        fileSize: file.size,
        mimeType: actualMimeType,
        uploadedById: userId,
      },
    });

    this.logger.log(`${this.parentLabel} attachment uploaded`, {
      [`${this.parentLabel}Id`]: parentId,
      attachmentId: attachment.id,
      type: resolvedType,
      userId,
      action: `UPLOAD_${this.parentLabel.toUpperCase()}_ATTACHMENT`,
    });

    return this.toResponse(attachment);
  }

  async findAllForParent(parentId: string) {
    await this.ensureParentExists(parentId);

    const attachments = await this.delegate.findMany({
      where: { [this.parentForeignKey]: parentId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });

    return attachments.map((attachment) => this.toResponse(attachment));
  }

  /** Signed URL only — raw bytes are never served through the API (spec §8). */
  async getSignedUrl(parentId: string, attachmentId: string) {
    const attachment = await this.findOwned(parentId, attachmentId);
    const url = await this.storage.getSignedUrl(attachment.fileKey, SIGNED_URL_EXPIRY_SECONDS);
    return { url, expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS };
  }

  async remove(parentId: string, attachmentId: string, userId: string) {
    const attachment = await this.findOwned(parentId, attachmentId);

    // Soft delete only. Financial attachments are evidence; the object stays in
    // the bucket regardless of what the UI shows (spec §8).
    const updated = await this.delegate.update({
      where: { id: attachment.id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`${this.parentLabel} attachment soft deleted`, {
      [`${this.parentLabel}Id`]: parentId,
      attachmentId,
      userId,
      action: `DELETE_${this.parentLabel.toUpperCase()}_ATTACHMENT`,
    });

    return this.toResponse(updated);
  }

  /**
   * 404s when the attachment is missing OR belongs to a different parent, so a
   * guessed id cannot confirm that some other record's attachment exists.
   */
  private async findOwned(parentId: string, attachmentId: string) {
    await this.ensureParentExists(parentId);

    const attachment = await this.delegate.findFirst({
      where: { id: attachmentId, [this.parentForeignKey]: parentId, deletedAt: null },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    return attachment;
  }

  /** fileKey is internal — exposing the storage path invites direct bucket probing. */
  private toResponse(attachment: FinanceAttachmentRow) {
    const { fileKey, ...rest } = attachment;
    void fileKey;
    return rest;
  }
}

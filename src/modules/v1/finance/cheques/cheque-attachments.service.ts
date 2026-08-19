import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { StorageService } from '../../../../shared/storage/storage.service';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';
import {
  FinanceAttachmentDelegate,
  FinanceAttachmentsBaseService,
} from '../shared/finance-attachments.base';

/** Scans of the physical cheque, and bank return slips after a bounce. */
@Injectable()
export class ChequeAttachmentsService extends FinanceAttachmentsBaseService {
  protected readonly logger = new Logger(ChequeAttachmentsService.name);
  protected readonly parentLabel = 'cheque';
  protected readonly keyPrefix = 'cheques';
  protected readonly parentForeignKey = 'chequeId';
  protected readonly defaultType = FinanceAttachmentType.CHEQUE_IMAGE;

  constructor(
    private readonly prisma: PrismaService,
    protected readonly storage: StorageService,
  ) {
    super();
  }

  protected get delegate(): FinanceAttachmentDelegate {
    return this.prisma.chequeAttachment as unknown as FinanceAttachmentDelegate;
  }

  protected async ensureParentExists(chequeId: string): Promise<void> {
    const cheque = await this.prisma.cheque.findFirst({
      where: { id: chequeId, deletedAt: null },
      select: { id: true },
    });

    if (!cheque) {
      throw new NotFoundException('Cheque not found');
    }
  }
}

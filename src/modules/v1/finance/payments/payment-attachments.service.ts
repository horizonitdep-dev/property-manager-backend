import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { StorageService } from '../../../../shared/storage/storage.service';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';
import {
  FinanceAttachmentDelegate,
  FinanceAttachmentsBaseService,
} from '../shared/finance-attachments.base';

/** Receipts and bank statements for a payment. Behaviour lives in the shared base. */
@Injectable()
export class PaymentAttachmentsService extends FinanceAttachmentsBaseService {
  protected readonly logger = new Logger(PaymentAttachmentsService.name);
  protected readonly parentLabel = 'payment';
  protected readonly keyPrefix = 'payments';
  protected readonly parentForeignKey = 'paymentId';
  protected readonly defaultType = FinanceAttachmentType.RECEIPT;

  constructor(
    private readonly prisma: PrismaService,
    protected readonly storage: StorageService,
  ) {
    super();
  }

  protected get delegate(): FinanceAttachmentDelegate {
    return this.prisma.paymentAttachment as unknown as FinanceAttachmentDelegate;
  }

  protected async ensureParentExists(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      select: { id: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
  }
}

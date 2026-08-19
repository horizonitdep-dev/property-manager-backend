import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { StorageService } from '../../../../shared/storage/storage.service';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';
import {
  FinanceAttachmentDelegate,
  FinanceAttachmentsBaseService,
} from '../shared/finance-attachments.base';

/** Vendor invoices and payment receipts backing an expense. */
@Injectable()
export class ExpenseAttachmentsService extends FinanceAttachmentsBaseService {
  protected readonly logger = new Logger(ExpenseAttachmentsService.name);
  protected readonly parentLabel = 'expense';
  protected readonly keyPrefix = 'expenses';
  protected readonly parentForeignKey = 'expenseId';
  protected readonly defaultType = FinanceAttachmentType.INVOICE;

  constructor(
    private readonly prisma: PrismaService,
    protected readonly storage: StorageService,
  ) {
    super();
  }

  protected get delegate(): FinanceAttachmentDelegate {
    return this.prisma.expenseAttachment as unknown as FinanceAttachmentDelegate;
  }

  protected async ensureParentExists(expenseId: string): Promise<void> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
      select: { id: true },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
  }
}

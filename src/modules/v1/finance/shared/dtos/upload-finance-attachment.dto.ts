import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FinanceAttachmentType } from '../../../../../common/enums/finance-attachment-type.enum';

/**
 * Shared by all three attachment upload endpoints. When omitted, each parent
 * applies its own sensible default — RECEIPT for payments, CHEQUE_IMAGE for
 * cheques, INVOICE for expenses.
 */
export class UploadFinanceAttachmentDto {
  @ApiPropertyOptional({
    enum: FinanceAttachmentType,
    description: 'Defaults per parent: payment → RECEIPT, cheque → CHEQUE_IMAGE, expense → INVOICE',
  })
  @IsOptional()
  @IsEnum(FinanceAttachmentType)
  type?: FinanceAttachmentType;
}

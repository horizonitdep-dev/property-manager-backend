import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChequeStatus } from '../../../../../common/enums/cheque-status.enum';
import {
  PaymentAttachmentSummaryDto,
  PaymentContractSummaryDto,
} from '../../payments/dtos/payment-response.dto';

/** One link in a replacement chain, without recursing into the whole chain. */
export class ChequeLinkSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  chequeNumber!: string;

  @ApiProperty()
  bankName!: string;

  @ApiProperty({ enum: ChequeStatus })
  status!: ChequeStatus;

  @ApiProperty({ type: String, example: '7000.00' })
  amount!: string;
}

export class ChequePaymentSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, example: '7000.00' })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  paidOn!: Date;
}

export class ChequeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  contractId!: string;

  @ApiProperty()
  chequeNumber!: string;

  @ApiProperty()
  bankName!: string;

  @ApiProperty({
    type: String,
    example: '7000.00',
    description: 'String, not a number — preserves Decimal(12,2) precision through JSON.',
  })
  amount!: string;

  @ApiProperty({ type: String, format: 'date', description: 'Date written on the cheque' })
  chequeDate!: Date;

  @ApiProperty({ enum: ChequeStatus })
  status!: ChequeStatus;

  @ApiProperty({ type: String, format: 'date' })
  receivedOn!: Date;

  @ApiPropertyOptional({ type: String, format: 'date' })
  depositedOn?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date' })
  clearedOn?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date' })
  bouncedOn?: Date | null;

  @ApiPropertyOptional()
  bounceReason?: string | null;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Set when this cheque was superseded' })
  replacedByChequeId?: string | null;

  @ApiPropertyOptional({
    type: ChequeLinkSummaryDto,
    description: 'The cheque that superseded this one',
  })
  replacedBy?: ChequeLinkSummaryDto | null;

  @ApiPropertyOptional({
    type: ChequeLinkSummaryDto,
    description: 'The cheque this one was created to replace',
  })
  replaces?: ChequeLinkSummaryDto | null;

  @ApiPropertyOptional({
    type: ChequePaymentSummaryDto,
    description: 'Present only while the cheque is CLEARED and its Payment is live',
  })
  payment?: ChequePaymentSummaryDto | null;

  @ApiPropertyOptional({ type: PaymentContractSummaryDto })
  contract?: PaymentContractSummaryDto;

  @ApiPropertyOptional({ type: [PaymentAttachmentSummaryDto] })
  attachments?: PaymentAttachmentSummaryDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty()
  createdById!: string;

  @ApiPropertyOptional()
  updatedById?: string | null;
}

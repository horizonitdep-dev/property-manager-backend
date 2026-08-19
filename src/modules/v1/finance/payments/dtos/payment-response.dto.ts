import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentKind } from '../../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../../common/enums/payment-method.enum';
import { FinanceAttachmentType } from '../../../../../common/enums/finance-attachment-type.enum';
import {
  ContractPropertySummaryDto,
  ContractTenantSummaryDto,
} from '../../../contracts/dtos/contract-response.dto';

export class PaymentAttachmentSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: FinanceAttachmentType })
  type!: FinanceAttachmentType;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  uploadedAt!: Date;

  @ApiProperty()
  uploadedById!: string;
}

/** The lease this money belongs to. Terms live in Contracts — repeated here only
 * as a read-only summary so callers do not need a second request. */
export class PaymentContractSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  contractNumber!: string;

  @ApiProperty({ type: ContractTenantSummaryDto })
  tenant!: ContractTenantSummaryDto;

  @ApiProperty({ type: ContractPropertySummaryDto })
  property!: ContractPropertySummaryDto;
}

export class PaymentChequeSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  chequeNumber!: string;

  @ApiProperty()
  bankName!: string;
}

export class PaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  contractId!: string;

  @ApiProperty({ enum: PaymentKind })
  kind!: PaymentKind;

  @ApiProperty({
    type: String,
    example: '2000.00',
    description:
      'Serialised as a STRING, not a number — Decimal(12,2) cannot round-trip through a JSON double without losing precision. Parse with a decimal library, not parseFloat, before doing arithmetic.',
  })
  amount!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-01-15' })
  paidOn!: Date;

  @ApiProperty({ enum: PaymentMethod })
  method!: PaymentMethod;

  @ApiPropertyOptional({ type: String, format: 'date' })
  periodStart?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date' })
  periodEnd?: Date | null;

  @ApiPropertyOptional({ description: 'Set only when this payment came from a cheque clearing' })
  chequeId?: string | null;

  @ApiPropertyOptional()
  referenceNumber?: string | null;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiProperty({
    description:
      'True when the payment was produced by a cheque clearing. Such payments cannot have their amount or date edited — the cheque is the source of truth.',
  })
  isChequeLinked!: boolean;

  @ApiPropertyOptional({ type: PaymentContractSummaryDto })
  contract?: PaymentContractSummaryDto;

  @ApiPropertyOptional({ type: PaymentChequeSummaryDto })
  cheque?: PaymentChequeSummaryDto | null;

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

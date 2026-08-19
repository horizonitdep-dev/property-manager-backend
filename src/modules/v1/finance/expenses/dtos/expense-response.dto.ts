import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '../../../../../common/enums/expense-category.enum';
import { ExpenseSourceType } from '../../../../../common/enums/expense-source-type.enum';
import { PaymentMethod } from '../../../../../common/enums/payment-method.enum';
import { PaymentAttachmentSummaryDto } from '../../payments/dtos/payment-response.dto';

export class ExpenseBuildingSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;
}

export class ExpensePropertySummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  unitNumber!: string;
}

export class ExpenseResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  buildingId!: string;

  @ApiPropertyOptional()
  propertyId?: string | null;

  @ApiProperty({ enum: ExpenseCategory })
  category!: ExpenseCategory;

  @ApiProperty({
    type: String,
    example: '1500.00',
    description: 'String, not a number — preserves Decimal(12,2) precision through JSON.',
  })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  incurredOn!: Date;

  @ApiProperty()
  vendorName!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: PaymentMethod })
  method!: PaymentMethod;

  @ApiPropertyOptional()
  invoiceNumber?: string | null;

  @ApiProperty({ enum: ExpenseSourceType })
  sourceType!: ExpenseSourceType;

  @ApiPropertyOptional({ description: 'The originating record when sourceType is not GENERAL' })
  sourceRefId?: string | null;

  @ApiPropertyOptional({ example: 'work_order' })
  sourceRefType?: string | null;

  @ApiProperty({
    description:
      'False when the expense was created by another module — the UI must not offer editing for those.',
  })
  isEditable!: boolean;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiPropertyOptional({ type: ExpenseBuildingSummaryDto })
  building?: ExpenseBuildingSummaryDto;

  @ApiPropertyOptional({ type: ExpensePropertySummaryDto })
  property?: ExpensePropertySummaryDto | null;

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

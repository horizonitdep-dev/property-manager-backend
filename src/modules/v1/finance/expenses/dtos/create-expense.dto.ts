import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ExpenseCategory } from '../../../../../common/enums/expense-category.enum';
import { ExpenseSourceType } from '../../../../../common/enums/expense-source-type.enum';
import { PaymentMethod } from '../../../../../common/enums/payment-method.enum';

/** True when the caller supplied a value at all — mirrors the tenants DTO helper. */
const isProvided = (value: unknown) => value !== undefined && value !== null && value !== '';

export class CreateExpenseDto {
  @ApiProperty({
    description:
      'Always required — an expense with no building cannot be attributed in the P&L (spec §5.3).',
  })
  @IsUUID()
  buildingId!: string;

  @ApiPropertyOptional({
    description: 'Optional unit-level attribution. Must belong to buildingId, or the request is rejected.',
  })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiProperty({ enum: ExpenseCategory, example: ExpenseCategory.MAINTENANCE })
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @ApiProperty({ example: 1500.0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  incurredOn!: string;

  @ApiProperty({ example: 'Al Reem Maintenance LLC' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  vendorName!: string;

  @ApiProperty({ example: 'Replaced the lobby AC compressor' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.BANK_TRANSFER })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ example: 'INV-2026-0042' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;

  @ApiPropertyOptional({
    enum: ExpenseSourceType,
    default: ExpenseSourceType.GENERAL,
    description:
      'Only GENERAL is used today. The others are the extension point for modules that originate expenses ' +
      '(Services, utility bills, bulk import) and require sourceRefId + sourceRefType.',
  })
  @IsOptional()
  @IsEnum(ExpenseSourceType)
  sourceType?: ExpenseSourceType;

  // Required together whenever sourceType is anything other than GENERAL, so an
  // originating module can always be traced back to its own record (spec §5.3).
  @ApiPropertyOptional({ description: 'Required when sourceType is not GENERAL' })
  @ValidateIf((o: CreateExpenseDto) => isProvided(o.sourceType) && o.sourceType !== ExpenseSourceType.GENERAL)
  @IsUUID()
  sourceRefId?: string;

  @ApiPropertyOptional({ example: 'work_order', description: 'Required when sourceType is not GENERAL' })
  @ValidateIf((o: CreateExpenseDto) => isProvided(o.sourceType) && o.sourceType !== ExpenseSourceType.GENERAL)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sourceRefType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaymentKind } from '../../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../../common/enums/payment-method.enum';

export const PAYMENT_SORT_FIELDS = ['paidOn', 'amount', 'createdAt'] as const;

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Search by reference number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({ description: "Filter via the payment's contract → tenant" })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ description: "Filter via the payment's contract → property" })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: "Filter via the payment's contract → property → building" })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentKind })
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  paidOnFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  paidOnTo?: string;

  @ApiPropertyOptional({
    description: 'true → only payments produced by a cheque clearing; false → only manual payments',
  })
  @IsOptional()
  // Query strings arrive as text, so "false" would otherwise be truthy.
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  linkedToCheque?: boolean;

  @ApiPropertyOptional({
    description:
      'Include payments whose contract has been soft-deleted. Off by default: reports and lists show active business only (spec §5.4).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeDeletedContracts?: boolean;

  @ApiPropertyOptional({ enum: PAYMENT_SORT_FIELDS, default: 'paidOn' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS)
  sortBy?: (typeof PAYMENT_SORT_FIELDS)[number] = 'paidOn';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

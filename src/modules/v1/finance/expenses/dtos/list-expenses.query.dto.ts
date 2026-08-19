import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
import { ExpenseCategory } from '../../../../../common/enums/expense-category.enum';
import { ExpenseSourceType } from '../../../../../common/enums/expense-source-type.enum';
import { PaymentMethod } from '../../../../../common/enums/payment-method.enum';

export const EXPENSE_SORT_FIELDS = ['incurredOn', 'amount', 'category', 'createdAt'] as const;

export class ListExpensesQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by vendor name, description or invoice number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ enum: ExpenseSourceType })
  @IsOptional()
  @IsEnum(ExpenseSourceType)
  sourceType?: ExpenseSourceType;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  incurredOnFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  incurredOnTo?: string;

  @ApiPropertyOptional({ enum: EXPENSE_SORT_FIELDS, default: 'incurredOn' })
  @IsOptional()
  @IsIn(EXPENSE_SORT_FIELDS)
  sortBy?: (typeof EXPENSE_SORT_FIELDS)[number] = 'incurredOn';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

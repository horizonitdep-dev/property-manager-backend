import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsIn, IsInt, Min, Max, IsUUID, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { ContractSource } from '../../../../common/enums/contract-source.enum';

export class ListContractsQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by contract number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: "Filter by the property's building" })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional({
    enum: ContractStatus,
    description:
      'Accepts computed statuses too (EXPIRING_SOON, EXPIRED) even though they are never stored directly',
  })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @ApiPropertyOptional({
    enum: ContractSource,
    description: 'Filter by which ingestion path created the contract',
  })
  @IsOptional()
  @IsEnum(ContractSource)
  source?: ContractSource;

  @ApiPropertyOptional({ description: 'Contracts starting on/after this date (for annual-count queries)' })
  @IsOptional()
  @IsDateString()
  startDateFrom?: string;

  @ApiPropertyOptional({ description: 'Contracts starting on/before this date (for annual-count queries)' })
  @IsOptional()
  @IsDateString()
  startDateTo?: string;

  @ApiPropertyOptional({
    enum: ['contractNumber', 'startDate', 'endDate', 'annualRent', 'createdAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['contractNumber', 'startDate', 'endDate', 'annualRent', 'createdAt'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

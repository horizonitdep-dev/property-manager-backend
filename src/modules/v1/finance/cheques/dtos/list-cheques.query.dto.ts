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
import { ChequeStatus } from '../../../../../common/enums/cheque-status.enum';

export const CHEQUE_SORT_FIELDS = ['chequeDate', 'receivedOn', 'amount', 'status', 'createdAt'] as const;

export class ListChequesQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by cheque number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ChequeStatus })
  @IsOptional()
  @IsEnum(ChequeStatus)
  status?: ChequeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({ description: "Filter via the cheque's contract → tenant" })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ description: "Filter via the cheque's contract → property" })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: "Filter via the cheque's contract → property → building" })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'chequeDate on/after' })
  @IsOptional()
  @IsDateString()
  chequeDateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'chequeDate on/before' })
  @IsOptional()
  @IsDateString()
  chequeDateTo?: string;

  @ApiPropertyOptional({ description: 'Include cheques whose contract has been soft-deleted (spec §5.4)' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeDeletedContracts?: boolean;

  @ApiPropertyOptional({ enum: CHEQUE_SORT_FIELDS, default: 'chequeDate' })
  @IsOptional()
  @IsIn(CHEQUE_SORT_FIELDS)
  sortBy?: (typeof CHEQUE_SORT_FIELDS)[number] = 'chequeDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}

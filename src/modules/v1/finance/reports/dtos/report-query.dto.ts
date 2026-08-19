import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { TenantType } from '../../../../../common/enums/tenant-type.enum';

export const PNL_GROUPINGS = ['building', 'property', 'month', 'quarter', 'year'] as const;

/** Shared scope filters — every report can be narrowed the same way. */
class ScopeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class OutstandingReportQueryDto extends ScopeQueryDto {
  @ApiPropertyOptional({
    example: '2026-04-01',
    description: 'Balances as they stood on this date. Defaults to today.',
  })
  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @ApiPropertyOptional({
    description: 'Only contracts with money currently owed — the arrears-chasing view.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  overdueOnly?: string;
}

export class PnlReportQueryDto extends ScopeQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Start of the reporting window (required)' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'End of the reporting window, inclusive (required)' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional({ enum: PNL_GROUPINGS, default: 'month' })
  @IsOptional()
  @IsIn(PNL_GROUPINGS)
  groupBy?: (typeof PNL_GROUPINGS)[number] = 'month';
}

export class RentRollReportQueryDto extends ScopeQueryDto {
  @ApiPropertyOptional({ example: '2026-04-01', description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  asOfDate?: string;
}

export class UpcomingChequesQueryDto extends ScopeQueryDto {
  @ApiPropertyOptional({
    default: 30,
    description: 'Look-ahead window in days for cheques still HELD or DEPOSITED',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  withinDays?: number = 30;
}

export class AnnualTenantCountQueryDto {
  @ApiProperty({ example: 2024, description: 'First calendar year to report' })
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2200)
  fromYear!: number;

  @ApiProperty({ example: 2026, description: 'Last calendar year to report, inclusive' })
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2200)
  toYear!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional({ enum: TenantType })
  @IsOptional()
  @IsEnum(TenantType)
  tenantType?: TenantType;
}

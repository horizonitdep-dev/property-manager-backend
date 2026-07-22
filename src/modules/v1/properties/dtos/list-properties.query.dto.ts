import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsIn, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { UnitType } from '../../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../../common/enums/property-status.enum';

export class ListPropertiesQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by unit number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by building' })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @ApiPropertyOptional({ enum: UnitType })
  @IsOptional()
  @IsEnum(UnitType)
  unitType?: UnitType;

  @ApiPropertyOptional({ enum: PropertyStatus })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;

  @ApiPropertyOptional({
    enum: ['unitNumber', 'floor', 'monthlyRent', 'createdAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['unitNumber', 'floor', 'monthlyRent', 'createdAt'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

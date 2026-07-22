import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
  IsPositive,
  IsNumber,
} from 'class-validator';
import { UnitType } from '../../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../../common/enums/property-status.enum';

export class CreatePropertyDto {
  @ApiProperty({ example: '101' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitNumber!: string;

  @ApiProperty({ example: 'b1f4c8b0-6f1a-4e2d-9c3a-2a1b3c4d5e6f' })
  @IsUUID()
  buildingId!: string;

  @ApiProperty({ example: 1, minimum: -5, maximum: 200 })
  @IsInt()
  @Min(-5)
  @Max(200)
  floor!: number;

  @ApiProperty({ enum: UnitType, example: UnitType.APARTMENT })
  @IsEnum(UnitType)
  unitType!: UnitType;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  bedrooms?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  bathrooms?: number;

  @ApiPropertyOptional({ example: 85.5 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  sizeSqm?: number;

  @ApiProperty({ example: 2500, minimum: 0 })
  @IsNumber()
  @Min(0)
  monthlyRent!: number;

  @ApiPropertyOptional({
    enum: PropertyStatus,
    example: PropertyStatus.VACANT,
    default: PropertyStatus.VACANT,
  })
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;

  @ApiPropertyOptional({ example: 'Corner unit with balcony' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

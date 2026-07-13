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
  Matches,
} from 'class-validator';
import { BuildingType } from '../../../../common/enums/building-type.enum';
import { ConstructionStatus } from '../../../../common/enums/construction-status.enum';

export class CreateBuildingDto {
  @ApiProperty({ example: 'Al Noor Tower' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'R6' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[A-Z0-9-]+$/, { message: 'Code must be uppercase letters, numbers, or hyphens' })
  code!: string;

  @ApiProperty({ example: 'Hamdan Street, Abu Dhabi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address!: string;

  @ApiProperty({ example: 'Abu Dhabi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ enum: BuildingType, example: BuildingType.RESIDENTIAL })
  @IsEnum(BuildingType)
  buildingType!: BuildingType;

  @ApiProperty({ example: 4, minimum: 1, maximum: 200 })
  @IsInt()
  @Min(1)
  @Max(200)
  totalFloors!: number;

  @ApiPropertyOptional({ example: 2015 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear())
  yearBuilt?: number;

  @ApiPropertyOptional({ example: 200, minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  totalUnits?: number;

  @ApiPropertyOptional({
    enum: ConstructionStatus,
    example: ConstructionStatus.COMPLETE,
    default: ConstructionStatus.COMPLETE,
  })
  @IsOptional()
  @IsEnum(ConstructionStatus)
  constructionStatus?: ConstructionStatus;

  @ApiPropertyOptional({ example: 'Has underground parking' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

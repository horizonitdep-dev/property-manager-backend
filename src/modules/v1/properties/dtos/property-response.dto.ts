import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnitType } from '../../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../../common/enums/property-status.enum';

export class PropertyBuildingSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;
}

export class PropertyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  unitNumber!: string;

  @ApiProperty()
  floor!: number;

  @ApiProperty({ enum: UnitType })
  unitType!: UnitType;

  @ApiPropertyOptional()
  bedrooms?: number | null;

  @ApiPropertyOptional()
  bathrooms?: number | null;

  @ApiPropertyOptional()
  sizeSqm?: number | null;

  @ApiProperty()
  monthlyRent!: number;

  @ApiProperty({ enum: PropertyStatus })
  status!: PropertyStatus;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiProperty({ type: PropertyBuildingSummaryDto })
  building!: PropertyBuildingSummaryDto;

  @ApiProperty()
  createdById!: string;

  @ApiPropertyOptional()
  updatedById?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional()
  deletedAt?: Date | null;
}

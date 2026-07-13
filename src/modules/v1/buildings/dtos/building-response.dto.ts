import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuildingType } from '../../../../common/enums/building-type.enum';
import { ConstructionStatus } from '../../../../common/enums/construction-status.enum';

export class BuildingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty({ enum: BuildingType })
  buildingType!: BuildingType;

  @ApiProperty()
  totalFloors!: number;

  @ApiPropertyOptional()
  yearBuilt?: number | null;

  @ApiPropertyOptional()
  totalUnits?: number | null;

  @ApiProperty({ enum: ConstructionStatus })
  constructionStatus!: ConstructionStatus;

  @ApiPropertyOptional()
  notes?: string | null;

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

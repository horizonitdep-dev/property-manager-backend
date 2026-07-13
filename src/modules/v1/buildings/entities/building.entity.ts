import { BuildingType } from '../../../../common/enums/building-type.enum';
import { ConstructionStatus } from '../../../../common/enums/construction-status.enum';

export class BuildingEntity {
  id!: string;
  name!: string;
  code!: string;
  address!: string;
  city!: string;
  buildingType!: BuildingType;
  totalFloors!: number;
  yearBuilt?: number | null;
  totalUnits?: number | null;
  constructionStatus!: ConstructionStatus;
  notes?: string | null;
  createdById!: string;
  updatedById?: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt?: Date | null;
}

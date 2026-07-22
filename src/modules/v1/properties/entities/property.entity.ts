import { UnitType } from '../../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../../common/enums/property-status.enum';

export class PropertyEntity {
  id!: string;
  unitNumber!: string;
  buildingId!: string;
  floor!: number;
  unitType!: UnitType;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sizeSqm?: number | null;
  monthlyRent!: number;
  status!: PropertyStatus;
  notes?: string | null;
  createdById!: string;
  updatedById?: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt?: Date | null;
}

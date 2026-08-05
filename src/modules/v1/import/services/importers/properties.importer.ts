import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../database/prisma.service';
import { PropertiesService } from '../../../properties/properties.service';
import { CreatePropertyDto } from '../../../properties/dtos/create-property.dto';
import { UnitType } from '../../../../../common/enums/unit-type.enum';
import { PropertyStatus } from '../../../../../common/enums/property-status.enum';
import { ImportModule } from '../../../../../common/enums/import-module.enum';
import { ParsedRow, getCell } from '../file-parser.service';
import { RowResult } from '../../row-result';
import { ModuleImporter } from './importer.interface';
import { ImportCommitRowError } from '../../import-commit-row.error';
import {
  DuplicateTracker,
  buildRowResult,
  mapOptionalEnumCell,
  mapRequiredEnumCell,
  validateAgainstDto,
} from './import-cell.utils';

const UNIT_TYPE_LABELS: Record<string, UnitType> = {
  apartment: UnitType.APARTMENT,
  studio: UnitType.STUDIO,
  shop: UnitType.SHOP,
  office: UnitType.OFFICE,
  'roof unit': UnitType.ROOF_UNIT,
  warehouse: UnitType.WAREHOUSE,
};

const PROPERTY_STATUS_LABELS: Record<string, PropertyStatus> = {
  vacant: PropertyStatus.VACANT,
  occupied: PropertyStatus.OCCUPIED,
  'under maintenance': PropertyStatus.UNDER_MAINTENANCE,
  reserved: PropertyStatus.RESERVED,
};

@Injectable()
export class PropertiesImporter implements ModuleImporter {
  readonly module = ImportModule.PROPERTIES;

  constructor(
    private readonly prisma: PrismaService,
    private readonly propertiesService: PropertiesService,
  ) {}

  async validateRows(rows: ParsedRow[]): Promise<RowResult[]> {
    const duplicateUnits = new DuplicateTracker();
    const results: RowResult[] = [];

    for (const row of rows) {
      const errors: { field: string; message: string }[] = [];

      const buildingCode = getCell(row, 'Building Code');
      const unitNumber = getCell(row, 'Unit Number');

      let buildingId: string | undefined;
      if (!buildingCode) {
        errors.push({ field: 'Building Code', message: 'Building Code is required' });
      } else {
        const building = await this.prisma.building.findFirst({
          where: { code: buildingCode, deletedAt: null },
        });
        if (!building) {
          errors.push({
            field: 'Building Code',
            message: `Building not found: '${buildingCode}'`,
          });
        } else {
          buildingId = building.id;
        }
      }

      const unitType = mapRequiredEnumCell(
        getCell(row, 'Unit Type'),
        'Unit Type',
        UNIT_TYPE_LABELS,
        errors,
      );
      const status = mapOptionalEnumCell(
        getCell(row, 'Status'),
        'Status',
        PROPERTY_STATUS_LABELS,
        errors,
      );

      const plain: Record<string, unknown> = {
        unitNumber: unitNumber ?? undefined,
        buildingId,
        floor: getCell(row, 'Floor') ?? undefined,
        unitType,
        bedrooms: getCell(row, 'Bedrooms') ?? undefined,
        bathrooms: getCell(row, 'Bathrooms') ?? undefined,
        sizeSqm: getCell(row, 'Size (sqm)') ?? undefined,
        monthlyRent: getCell(row, 'Monthly Rent') ?? undefined,
        status,
        notes: getCell(row, 'Notes') ?? undefined,
      };

      const { errors: dtoErrors, value: coerced } = await validateAgainstDto(
        CreatePropertyDto,
        plain,
      );
      errors.push(...dtoErrors);

      if (buildingCode && unitNumber) {
        const key = `${buildingCode}::${unitNumber}`;
        const firstRow = duplicateUnits.check(key, row.rowNumber);
        if (firstRow !== null) {
          errors.push({
            field: 'Unit Number',
            message: `Duplicate Unit Number '${unitNumber}' in building '${buildingCode}' — already used in row ${firstRow}`,
          });
        } else if (buildingId && !errors.some((e) => e.field === 'Unit Number')) {
          const existing = await this.prisma.property.findFirst({
            where: { buildingId, unitNumber, deletedAt: null },
          });
          if (existing) {
            errors.push({
              field: 'Unit Number',
              message: `Unit Number '${unitNumber}' already exists in building '${buildingCode}'`,
            });
          }
        }
      }

      const resolvedRefs = buildingId ? { buildingId } : undefined;
      results.push(
        buildRowResult(row.rowNumber, coerced as unknown as Record<string, unknown>, errors, resolvedRefs),
      );
    }

    return results;
  }

  async commitRows(validRows: RowResult[], userId: string): Promise<number> {
    let inserted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of validRows) {
        try {
          await this.propertiesService.create(
            row.data as unknown as CreatePropertyDto,
            userId,
            tx as Prisma.TransactionClient,
          );
          inserted++;
        } catch (error) {
          throw new ImportCommitRowError(row.rowNumber, (error as Error).message);
        }
      }
    });

    return inserted;
  }
}

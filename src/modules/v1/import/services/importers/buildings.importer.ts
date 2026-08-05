import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../database/prisma.service';
import { BuildingsService } from '../../../buildings/buildings.service';
import { CreateBuildingDto } from '../../../buildings/dtos/create-building.dto';
import { BuildingType } from '../../../../../common/enums/building-type.enum';
import { ConstructionStatus } from '../../../../../common/enums/construction-status.enum';
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

const BUILDING_TYPE_LABELS: Record<string, BuildingType> = {
  residential: BuildingType.RESIDENTIAL,
  commercial: BuildingType.COMMERCIAL,
  'mixed-use': BuildingType.MIXED_USE,
  'mixed use': BuildingType.MIXED_USE,
};

const CONSTRUCTION_STATUS_LABELS: Record<string, ConstructionStatus> = {
  complete: ConstructionStatus.COMPLETE,
  'under construction': ConstructionStatus.UNDER_CONSTRUCTION,
};

@Injectable()
export class BuildingsImporter implements ModuleImporter {
  readonly module = ImportModule.BUILDINGS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly buildingsService: BuildingsService,
  ) {}

  async validateRows(rows: ParsedRow[]): Promise<RowResult[]> {
    const duplicateCodes = new DuplicateTracker();
    const results: RowResult[] = [];

    for (const row of rows) {
      const errors: { field: string; message: string }[] = [];

      const code = getCell(row, 'Building Code');
      const buildingType = mapRequiredEnumCell(
        getCell(row, 'Building Type'),
        'Building Type',
        BUILDING_TYPE_LABELS,
        errors,
      );
      const constructionStatus = mapOptionalEnumCell(
        getCell(row, 'Construction Status'),
        'Construction Status',
        CONSTRUCTION_STATUS_LABELS,
        errors,
      );

      const plain: Record<string, unknown> = {
        name: getCell(row, 'Building Name') ?? undefined,
        code: code ?? undefined,
        address: getCell(row, 'Address') ?? undefined,
        city: getCell(row, 'City') ?? undefined,
        buildingType,
        totalFloors: getCell(row, 'Total Floors') ?? undefined,
        totalUnits: getCell(row, 'Total Units') ?? undefined,
        constructionStatus,
        notes: getCell(row, 'Notes') ?? undefined,
      };

      const { errors: dtoErrors, value: coerced } = await validateAgainstDto(CreateBuildingDto, plain);
      errors.push(...dtoErrors);

      if (code) {
        const firstRow = duplicateCodes.check(code, row.rowNumber);
        if (firstRow !== null) {
          errors.push({
            field: 'code',
            message: `Duplicate Building Code '${code}' — already used in row ${firstRow}`,
          });
        } else if (!errors.some((e) => e.field === 'code')) {
          const existing = await this.prisma.building.findFirst({
            where: { code, deletedAt: null },
          });
          if (existing) {
            errors.push({ field: 'code', message: `Building Code '${code}' already exists` });
          }
        }
      }

      results.push(buildRowResult(row.rowNumber, coerced as unknown as Record<string, unknown>, errors));
    }

    return results;
  }

  async commitRows(validRows: RowResult[], userId: string): Promise<number> {
    let inserted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of validRows) {
        try {
          await this.buildingsService.create(
            row.data as unknown as CreateBuildingDto,
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

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../database/prisma.service';
import { TenantsService } from '../../../tenants/tenants.service';
import { CreateTenantDto } from '../../../tenants/dtos/create-tenant.dto';
import { TenantType } from '../../../../../common/enums/tenant-type.enum';
import { TenantStatus } from '../../../../../common/enums/tenant-status.enum';
import { ImportModule } from '../../../../../common/enums/import-module.enum';
import { ParsedRow, getCell } from '../file-parser.service';
import { RowResult } from '../../row-result';
import { ModuleImporter } from './importer.interface';
import { ImportCommitRowError } from '../../import-commit-row.error';
import { getMissingTenantTypeFields } from '../../../tenants/validators/tenant-type-fields.validator';
import {
  buildRowResult,
  mapDateCell,
  mapOptionalEnumCell,
  mapRequiredEnumCell,
  validateAgainstDto,
} from './import-cell.utils';

const TENANT_TYPE_LABELS: Record<string, TenantType> = {
  individual: TenantType.INDIVIDUAL,
  company: TenantType.COMPANY,
};

const TENANT_STATUS_LABELS: Record<string, TenantStatus> = {
  active: TenantStatus.ACTIVE,
  former: TenantStatus.FORMER,
};

@Injectable()
export class TenantsImporter implements ModuleImporter {
  readonly module = ImportModule.TENANTS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantsService: TenantsService,
  ) {}

  async validateRows(rows: ParsedRow[]): Promise<RowResult[]> {
    const results: RowResult[] = [];

    for (const row of rows) {
      const errors: { field: string; message: string }[] = [];

      const tenantType = mapRequiredEnumCell(
        getCell(row, 'Tenant Type'),
        'Tenant Type',
        TENANT_TYPE_LABELS,
        errors,
      );
      const status = mapOptionalEnumCell(getCell(row, 'Status'), 'Status', TENANT_STATUS_LABELS, errors);

      const plain: Record<string, unknown> = {
        tenantType,
        nameEn: getCell(row, 'Full Name (English)') ?? undefined,
        nameAr: getCell(row, 'Full Name (Arabic)') ?? undefined,
        phone: getCell(row, 'Phone') ?? undefined,
        alternatePhone: getCell(row, 'Alternate Phone') ?? undefined,
        email: getCell(row, 'Email') ?? undefined,
        nationality: getCell(row, 'Nationality') ?? undefined,
        emiratesIdNumber: getCell(row, 'Emirates ID Number') ?? undefined,
        emiratesIdExpiry: mapDateCell(getCell(row, 'Emirates ID Expiry'), 'Emirates ID Expiry', errors),
        passportNumber: getCell(row, 'Passport Number') ?? undefined,
        passportExpiry: mapDateCell(getCell(row, 'Passport Expiry'), 'Passport Expiry', errors),
        tradeLicenseNumber: getCell(row, 'Trade License Number') ?? undefined,
        tradeLicenseExpiry: mapDateCell(
          getCell(row, 'Trade License Expiry'),
          'Trade License Expiry',
          errors,
        ),
        authorizedPersonNameEn: getCell(row, 'Authorized Person (English)') ?? undefined,
        authorizedPersonNameAr: getCell(row, 'Authorized Person (Arabic)') ?? undefined,
        authorizedPersonOccupation: getCell(row, 'Authorized Person Occupation') ?? undefined,
        authorizedPersonPhone: getCell(row, 'Authorized Person Phone') ?? undefined,
        status,
        notes: getCell(row, 'Notes') ?? undefined,
      };

      const { errors: dtoErrors, value: coerced } = await validateAgainstDto(CreateTenantDto, plain);
      errors.push(...dtoErrors);

      // The DTO's own @RequiredForTenantType constraint sits behind @ValidateIf on the
      // same property, which gates ALL validators there together — so it never actually
      // fires when a field is blank (the one case it exists to catch). getMissingTenantTypeFields
      // is the same shared checker TenantsService.create()/.update() rely on as their real
      // enforcement; call it directly here too rather than trust the DTO path alone.
      const missing = getMissingTenantTypeFields(coerced as unknown as { tenantType?: string | null });
      for (const field of missing) {
        errors.push({ field, message: `${field} is required when tenantType is ${tenantType}` });
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
          await this.tenantsService.create(
            row.data as unknown as CreateTenantDto,
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

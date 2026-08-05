import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../database/prisma.service';
import { ContractsService } from '../../../contracts/contracts.service';
import { CreateContractDto } from '../../../contracts/dtos/create-contract.dto';
import { isNumberOfChequesMissing } from '../../../contracts/validators/contract-dates.validator';
import { PaymentFrequency } from '../../../../../common/enums/payment-frequency.enum';
import { ContractStatus } from '../../../../../common/enums/contract-status.enum';
import { ImportModule } from '../../../../../common/enums/import-module.enum';
import { ParsedRow, getCell } from '../file-parser.service';
import { RowResult } from '../../row-result';
import { ModuleImporter } from './importer.interface';
import { ImportCommitRowError } from '../../import-commit-row.error';
import {
  FieldErrors,
  buildRowResult,
  mapDateCell,
  mapOptionalEnumCell,
  mapRequiredEnumCell,
  validateAgainstDto,
} from './import-cell.utils';

const PAYMENT_FREQUENCY_LABELS: Record<string, PaymentFrequency> = {
  monthly: PaymentFrequency.MONTHLY,
  quarterly: PaymentFrequency.QUARTERLY,
  'bi-annual': PaymentFrequency.BI_ANNUAL,
  'bi annual': PaymentFrequency.BI_ANNUAL,
  annual: PaymentFrequency.ANNUAL,
  'single payment': PaymentFrequency.SINGLE_PAYMENT,
  cheques: PaymentFrequency.CHEQUES,
};

// Only these two are settable via import — EXPIRING_SOON/EXPIRED are computed, never
// stored, and TERMINATED is only ever reached via the terminate endpoint (mirrors
// CreateContractDto's own CREATABLE_STATUSES restriction).
const CONTRACT_IMPORT_STATUS_LABELS: Record<string, ContractStatus> = {
  draft: ContractStatus.DRAFT,
  active: ContractStatus.ACTIVE,
};

@Injectable()
export class ContractsImporter implements ModuleImporter {
  readonly module = ImportModule.CONTRACTS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contractsService: ContractsService,
  ) {}

  async validateRows(rows: ParsedRow[]): Promise<RowResult[]> {
    const results: RowResult[] = [];

    for (const row of rows) {
      const errors: FieldErrors = [];

      const tenantId = await this.resolveTenant(getCell(row, 'Tenant Name (English)'), errors);
      const propertyId = await this.resolveProperty(
        getCell(row, 'Building Code'),
        getCell(row, 'Unit Number'),
        errors,
      );

      const startDate = mapDateCell(getCell(row, 'Start Date'), 'Start Date', errors);
      const endDate = mapDateCell(getCell(row, 'End Date'), 'End Date', errors);
      const paymentFrequency = mapRequiredEnumCell(
        getCell(row, 'Payment Frequency'),
        'Payment Frequency',
        PAYMENT_FREQUENCY_LABELS,
        errors,
      );
      const status = mapOptionalEnumCell(
        getCell(row, 'Status'),
        'Status',
        CONTRACT_IMPORT_STATUS_LABELS,
        errors,
      );

      const plain: Record<string, unknown> = {
        contractNumber: getCell(row, 'Contract Number') ?? undefined,
        tenantId,
        propertyId,
        startDate,
        endDate,
        annualRent: getCell(row, 'Annual Rent') ?? undefined,
        monthlyRent: getCell(row, 'Monthly Rent') ?? undefined,
        paymentFrequency,
        numberOfCheques: getCell(row, 'Number of Cheques') ?? undefined,
        securityDeposit: getCell(row, 'Security Deposit') ?? undefined,
        status,
        notes: getCell(row, 'Notes') ?? undefined,
      };

      const { errors: dtoErrors, value: coerced } = await validateAgainstDto(CreateContractDto, plain);
      errors.push(...dtoErrors);

      // Same @ValidateIf-masking issue as Tenants' conditional fields (see tenants.importer.ts):
      // the DTO's @RequiredWhenCheques constraint sits behind @ValidateIf on the same
      // property, so it never fires when numberOfCheques is blank — the one case it
      // exists to catch. ContractsService.create() already compensates for this with its
      // own direct check; call the same shared function here too.
      if (
        isNumberOfChequesMissing(
          coerced as unknown as { paymentFrequency?: string | null; numberOfCheques?: number | null },
        )
      ) {
        errors.push({
          field: 'numberOfCheques',
          message: 'numberOfCheques is required when paymentFrequency is CHEQUES',
        });
      }

      // Hard rule (§7.2), checked early for a clear preview message. This is a
      // dry-run pre-check only — ContractsService.create() re-checks for real at
      // commit time (via the same query), which is the actual enforcement and also
      // catches two rows in the same file that would overlap each other.
      const effectiveStatus = status ?? ContractStatus.DRAFT;
      if (effectiveStatus === ContractStatus.ACTIVE && propertyId && startDate && endDate) {
        const conflict = await this.prisma.contract.findFirst({
          where: {
            propertyId,
            status: ContractStatus.ACTIVE,
            deletedAt: null,
            startDate: { lte: new Date(endDate) },
            endDate: { gte: new Date(startDate) },
          },
        });
        if (conflict) {
          errors.push({
            field: 'Status',
            message: `Property already has an active contract (${conflict.contractNumber}) overlapping these dates`,
          });
        }
      }

      const resolvedRefs: Record<string, string> = {};
      if (tenantId) resolvedRefs.tenantId = tenantId;
      if (propertyId) resolvedRefs.propertyId = propertyId;

      results.push(
        buildRowResult(
          row.rowNumber,
          coerced as unknown as Record<string, unknown>,
          errors,
          Object.keys(resolvedRefs).length > 0 ? resolvedRefs : undefined,
        ),
      );
    }

    return results;
  }

  async commitRows(validRows: RowResult[], userId: string): Promise<number> {
    let inserted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of validRows) {
        try {
          await this.contractsService.create(
            row.data as unknown as CreateContractDto,
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

  private async resolveTenant(name: string | null, errors: FieldErrors): Promise<string | undefined> {
    if (!name) {
      errors.push({ field: 'Tenant Name (English)', message: 'Tenant Name (English) is required' });
      return undefined;
    }

    const matches = await this.prisma.tenant.findMany({
      where: { nameEn: { equals: name, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });

    if (matches.length === 0) {
      errors.push({ field: 'Tenant Name (English)', message: `Tenant not found: '${name}'` });
      return undefined;
    }
    if (matches.length > 1) {
      errors.push({
        field: 'Tenant Name (English)',
        message: `Ambiguous tenant '${name}' matches ${matches.length} records`,
      });
      return undefined;
    }
    return matches[0].id;
  }

  private async resolveProperty(
    buildingCode: string | null,
    unitNumber: string | null,
    errors: FieldErrors,
  ): Promise<string | undefined> {
    if (!buildingCode) {
      errors.push({ field: 'Building Code', message: 'Building Code is required' });
      return undefined;
    }
    if (!unitNumber) {
      errors.push({ field: 'Unit Number', message: 'Unit Number is required' });
      return undefined;
    }

    const building = await this.prisma.building.findFirst({
      where: { code: buildingCode, deletedAt: null },
    });
    if (!building) {
      errors.push({ field: 'Building Code', message: `Building not found: '${buildingCode}'` });
      return undefined;
    }

    const property = await this.prisma.property.findFirst({
      where: { buildingId: building.id, unitNumber, deletedAt: null },
    });
    if (!property) {
      errors.push({
        field: 'Unit Number',
        message: `Property not found: unit '${unitNumber}' in building '${buildingCode}'`,
      });
      return undefined;
    }
    return property.id;
  }
}

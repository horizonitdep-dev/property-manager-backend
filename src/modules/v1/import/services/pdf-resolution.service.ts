import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { CreateBuildingDto } from '../../buildings/dtos/create-building.dto';
import { CreatePropertyDto } from '../../properties/dtos/create-property.dto';
import { CreateTenantDto } from '../../tenants/dtos/create-tenant.dto';
import { CreateContractDto } from '../../contracts/dtos/create-contract.dto';
import { ExtractedContractResult } from '../pdf-extraction-result';
import { RowResult } from '../row-result';
import {
  BUILDING_TYPE_LABELS,
  UNIT_TYPE_LABELS,
  TENANT_TYPE_LABELS,
  PAYMENT_FREQUENCY_LABELS,
} from '../enum-label-maps';
import { buildRowResult, mapEnumLabel, validateAgainstDto } from './importers/import-cell.utils';

/**
 * Placeholder UUID for a Contract row's tenantId/propertyId when the parent is a
 * NEW candidate created earlier in the SAME PDF batch (not yet in the DB — no real
 * id exists until the Buildings/Properties/Tenants sessions actually commit).
 * Satisfies CreateContractDto's @IsUUID() format check during preview only;
 * PdfImportService swaps it for the real id at commit time, once the parent
 * has actually been created. See resolvedRefs on the contract row for which
 * pending candidate it really points at.
 */
export const PENDING_ID_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

export interface PdfExtractionWithRowNumber {
  result: ExtractedContractResult;
  rowNumber: number;
}

export interface KeyedRows {
  rows: RowResult[];
  /** keys[i] is the dedupe key for rows[i] — e.g. the building's propertyRegistrationNo. */
  keys: string[];
}

export interface PdfBatchResolution {
  buildings: KeyedRows;
  properties: KeyedRows;
  tenants: KeyedRows;
  contracts: RowResult[];
}

@Injectable()
export class PdfResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /** §7: resolve each extracted building/property/tenant against the DB, deduping
   * within the batch so the same building/tenant across multiple PDFs becomes one
   * candidate row, not several. */
  async resolveBatch(extractions: PdfExtractionWithRowNumber[]): Promise<PdfBatchResolution> {
    const buildingResolver = new EntityResolver();
    const tenantResolver = new EntityResolver();
    const propertyResolver = new EntityResolver();

    const buildingRows: RowResult[] = [];
    const buildingKeys: string[] = [];
    const tenantRows: RowResult[] = [];
    const tenantKeys: string[] = [];
    const propertyRows: RowResult[] = [];
    const propertyKeys: string[] = [];
    const contractRows: RowResult[] = [];

    for (const { result, rowNumber } of extractions) {
      const buildingRef = await this.resolveBuilding(result, rowNumber, buildingResolver, buildingRows, buildingKeys);
      const tenantRef = await this.resolveTenant(result, rowNumber, tenantResolver, tenantRows, tenantKeys);

      const unitRefs = await Promise.all(
        result.units.map((unit) =>
          this.resolveProperty(
            result,
            unit,
            rowNumber,
            buildingRef,
            propertyResolver,
            propertyRows,
            propertyKeys,
          ),
        ),
      );

      contractRows.push(
        await this.buildContractRow(result, rowNumber, tenantRef, unitRefs[0], unitRefs.slice(1)),
      );
    }

    return {
      buildings: { rows: buildingRows, keys: buildingKeys },
      properties: { rows: propertyRows, keys: propertyKeys },
      tenants: { rows: tenantRows, keys: tenantKeys },
      contracts: contractRows,
    };
  }

  private async resolveBuilding(
    result: ExtractedContractResult,
    rowNumber: number,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
  ): Promise<EntityRef> {
    const key = normalizeKey(result.building.propertyRegistrationNo);
    const cached = resolver.get(key);
    if (cached) return cached;

    const code = result.building.code;
    const existing = await this.prisma.building.findFirst({ where: { code, deletedAt: null } });
    if (existing) {
      const ref: EntityRef = { id: existing.id };
      resolver.set(key, ref);
      return ref;
    }

    const buildingType = mapEnumLabel('Commercial', BUILDING_TYPE_LABELS) ?? undefined;
    const plain: Record<string, unknown> = {
      name: result.building.name,
      code,
      address: result.building.address,
      city: result.building.city,
      buildingType,
      totalFloors: 1,
      notes: 'Created from DMT PDF ingestion — please confirm floors/type/city.',
    };
    const { errors, value } = await validateAgainstDto(CreateBuildingDto, plain);

    outRows.push(buildRowResult(rowNumber, value as unknown as Record<string, unknown>, errors));
    outKeys.push(key);
    const ref: EntityRef = { pendingIndex: outRows.length - 1 };
    resolver.set(key, ref);
    return ref;
  }

  private async resolveTenant(
    result: ExtractedContractResult,
    rowNumber: number,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
  ): Promise<EntityRef> {
    const key = normalizeKey(result.tenant.tradeLicenseNumber || result.tenant.nameEn);
    const cached = resolver.get(key);
    if (cached) return cached;

    const existing = result.tenant.tradeLicenseNumber
      ? await this.prisma.tenant.findFirst({
          where: { tradeLicenseNumber: result.tenant.tradeLicenseNumber, deletedAt: null },
        })
      : await this.prisma.tenant.findFirst({
          where: { nameEn: { equals: result.tenant.nameEn, mode: 'insensitive' }, deletedAt: null },
        });
    if (existing) {
      const ref: EntityRef = { id: existing.id };
      resolver.set(key, ref);
      return ref;
    }

    const tenantType = mapEnumLabel(result.tenant.tenantType, TENANT_TYPE_LABELS) ?? undefined;
    const plain: Record<string, unknown> = {
      tenantType,
      nameEn: result.tenant.nameEn,
      nameAr: result.tenant.nameAr,
      phone: result.tenant.phone,
      email: result.tenant.email,
      tradeLicenseNumber: result.tenant.tradeLicenseNumber,
    };
    const { errors, value } = await validateAgainstDto(CreateTenantDto, plain);

    outRows.push(buildRowResult(rowNumber, value as unknown as Record<string, unknown>, errors));
    outKeys.push(key);
    const ref: EntityRef = { pendingIndex: outRows.length - 1 };
    resolver.set(key, ref);
    return ref;
  }

  private async resolveProperty(
    result: ExtractedContractResult,
    unit: ExtractedContractResult['units'][number],
    rowNumber: number,
    buildingRef: EntityRef,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
  ): Promise<EntityRef> {
    const buildingKey = normalizeKey(result.building.propertyRegistrationNo);
    const key = `${buildingKey}::${normalizeKey(unit.unitNumber)}`;
    const cached = resolver.get(key);
    if (cached) return cached;

    if (buildingRef.id) {
      const existing = await this.prisma.property.findFirst({
        where: { buildingId: buildingRef.id, unitNumber: unit.unitNumber, deletedAt: null },
      });
      if (existing) {
        const ref: EntityRef = { id: existing.id };
        resolver.set(key, ref);
        return ref;
      }
    }

    const unitType = mapEnumLabel(unit.unitType, UNIT_TYPE_LABELS) ?? undefined;
    const errors: { field: string; message: string }[] = [];
    if (!unitType) {
      errors.push({
        field: 'unitType',
        message: `Unit Type '${unit.unitType}' is not recognized. Allowed values: ${Object.keys(UNIT_TYPE_LABELS).join(', ')}`,
      });
    }

    const plain: Record<string, unknown> = {
      unitNumber: unit.unitNumber,
      buildingId: buildingRef.id ?? PENDING_ID_PLACEHOLDER,
      floor: 1,
      unitType,
      sizeSqm: unit.sizeSqm,
      monthlyRent: result.contract.monthlyRent,
      notes: 'Created from DMT PDF ingestion — please confirm floor.',
    };
    const { errors: dtoErrors, value } = await validateAgainstDto(CreatePropertyDto, plain);

    outRows.push(
      buildRowResult(rowNumber, value as unknown as Record<string, unknown>, [...errors, ...dtoErrors], {
        buildingId: entityRefToken(buildingRef, 'building'),
      }),
    );
    outKeys.push(key);
    const ref: EntityRef = { pendingIndex: outRows.length - 1 };
    resolver.set(key, ref);
    return ref;
  }

  private async buildContractRow(
    result: ExtractedContractResult,
    rowNumber: number,
    tenantRef: EntityRef,
    firstUnitRef: EntityRef,
    otherUnitRefs: EntityRef[],
  ): Promise<RowResult> {
    const errors: { field: string; message: string }[] = [];
    const paymentFrequency = mapEnumLabel(result.contract.paymentFrequency, PAYMENT_FREQUENCY_LABELS) ?? undefined;
    if (!paymentFrequency) {
      errors.push({
        field: 'paymentFrequency',
        message: `Payment Frequency '${result.contract.paymentFrequency}' is not recognized. Allowed values: ${Object.keys(PAYMENT_FREQUENCY_LABELS).join(', ')}`,
      });
    }

    const plain: Record<string, unknown> = {
      contractNumber: result.contract.contractNumber,
      tenantId: tenantRef.id ?? PENDING_ID_PLACEHOLDER,
      propertyId: firstUnitRef.id ?? PENDING_ID_PLACEHOLDER,
      startDate: result.contract.startDate,
      endDate: result.contract.endDate,
      annualRent: result.contract.annualRent,
      monthlyRent: result.contract.monthlyRent,
      paymentFrequency,
      numberOfCheques: result.contract.numberOfCheques,
      securityDeposit: result.contract.securityDeposit,
      notes: result.contract.notes,
    };

    const { errors: dtoErrors, value } = await validateAgainstDto(CreateContractDto, plain);

    const resolvedRefs: Record<string, string> = {
      tenantId: entityRefToken(tenantRef, 'tenant'),
      propertyId: entityRefToken(firstUnitRef, 'property'),
    };
    if (otherUnitRefs.length > 0) {
      resolvedRefs.additionalPropertyIds = otherUnitRefs.map((ref) => entityRefToken(ref, 'property')).join(',');
    }

    return buildRowResult(
      rowNumber,
      value as unknown as Record<string, unknown>,
      [...errors, ...dtoErrors],
      resolvedRefs,
    );
  }
}

interface EntityRef {
  id?: string;
  pendingIndex?: number;
}

function entityRefToken(ref: EntityRef, kind: 'tenant' | 'property' | 'building'): string {
  return ref.id ? ref.id : `pending:${kind}:${ref.pendingIndex}`;
}

class EntityResolver {
  private readonly map = new Map<string, EntityRef>();

  get(key: string): EntityRef | undefined {
    return this.map.get(key);
  }

  set(key: string, ref: EntityRef): void {
    this.map.set(key, ref);
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

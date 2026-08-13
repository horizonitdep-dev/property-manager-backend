import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import {
  buildRowResult,
  mapEnumLabel,
  validateAgainstDto,
  DuplicateTracker,
} from './importers/import-cell.utils';
import { missingRequiredTenantFields } from '../pdf-tenant-import-fields';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';

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
    // Buildings/properties/tenants dedupe by REUSING the existing record (a batch
    // of contracts legitimately shares a building). A contract has no such
    // reuse — the same contract number twice is always a duplicate import.
    const duplicateContracts = new DuplicateTracker();

    const buildingRows: RowResult[] = [];
    const buildingKeys: string[] = [];
    const tenantRows: RowResult[] = [];
    const tenantKeys: string[] = [];
    const propertyRows: RowResult[] = [];
    const propertyKeys: string[] = [];
    const contractRows: RowResult[] = [];

    const codeIndex = await this.buildCodeIndex();

    for (const { result, rowNumber } of extractions) {
      const buildingRef = await this.resolveBuilding(
        result,
        rowNumber,
        buildingResolver,
        buildingRows,
        buildingKeys,
        codeIndex,
      );
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
        await this.buildContractRow(
          result,
          rowNumber,
          tenantRef,
          unitRefs[0],
          unitRefs.slice(1),
          duplicateContracts,
        ),
      );
    }

    return {
      buildings: { rows: buildingRows, keys: buildingKeys },
      properties: { rows: propertyRows, keys: propertyKeys },
      tenants: { rows: tenantRows, keys: tenantKeys },
      contracts: contractRows,
    };
  }

  /**
   * Every live building keyed by canonical code, loaded once per batch. Cheap
   * (buildings are few, and it replaces one query per PDF), and it's what lets
   * the lookup be order-insensitive — something a plain `where: { code }` can't do.
   *
   * On a collision (two existing buildings that differ only in component order)
   * the first by creation wins, so imports attach to the original record.
   */
  private async buildCodeIndex(): Promise<Map<string, { id: string; code: string }>> {
    const buildings = await this.prisma.building.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
    });

    const index = new Map<string, { id: string; code: string }>();
    for (const building of buildings) {
      const key = canonicalBuildingKey(building.code);
      if (!index.has(key)) index.set(key, building);
    }
    return index;
  }

  private async resolveBuilding(
    result: ExtractedContractResult,
    rowNumber: number,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
    codeIndex: Map<string, { id: string; code: string }>,
  ): Promise<EntityRef> {
    // Key on the code's canonical form so the in-batch cache and the existing-building
    // lookup agree, and so neither the component ORDER nor punctuation can split one
    // building into two. Keying on propertyRegistrationNo instead would let two PDFs
    // whose registration numbers differ but whose plot+sector match become separate
    // pending rows with an identical code — the second then fails the DB's unique
    // index mid-transaction and rolls back the whole batch.
    const code = result.building.code;
    const key = canonicalBuildingKey(code);
    const cached = resolver.get(key);
    if (cached) return cached;

    // Reuse an existing building whichever order its code was written in, so a
    // building already registered as 'R6-MZW16' is never re-registered as
    // 'MZW16-R6'. Its stored code is left exactly as it is — the PDF links to
    // the existing record, it does not rename it.
    const existing = codeIndex.get(key);
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
    const identity = tenantIdentity(result.tenant);
    const key = identity.key;
    const cached = resolver.get(key);
    if (cached) return cached;

    // Unlike buildings/properties, tenants have NO unique index backing them up,
    // so this lookup is the only thing standing between a re-import and a
    // duplicate tenant. Match on the strongest identifier the PDF gave us.
    const existing = await this.prisma.tenant.findFirst({
      where: { ...identity.where, deletedAt: null },
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
      emiratesIdNumber: result.tenant.emiratesIdNumber,
      passportNumber: result.tenant.passportNumber,
      nationality: result.tenant.nationality,
    };
    const { errors, value } = await validateAgainstDto(CreateTenantDto, plain);

    // The DTO alone can't catch an ABSENT tenant-type-required field (see
    // missingRequiredTenantFields). Without this, such a row previews as VALID
    // and then fails the service's own check at commit, rolling back the batch.
    for (const field of missingRequiredTenantFields(value as unknown as Record<string, unknown>)) {
      errors.push({ field, message: `${field} is required when tenantType is ${tenantType}` });
    }

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
    // Scope the key by the SAME building identity resolveBuilding used (its code,
    // or the resolved id for one already in the DB) — keying by
    // propertyRegistrationNo here while the building keys by code lets the two
    // disagree about which units share a building.
    const buildingKey = buildingRef.id ?? canonicalBuildingKey(result.building.code);
    const key = `${buildingKey}::${normalizeKey(unit.unitNumber)}`;
    const cached = resolver.get(key);
    if (cached) return cached;

    if (buildingRef.id) {
      const existing = await this.prisma.property.findFirst({
        // Case-insensitive to match the in-batch key, which is normalized: an
        // exact match would treat 'Shop 7' and 'SHOP 7' as the same unit within
        // the batch but as different ones against the DB, and the resulting
        // insert would then violate properties_building_id_unit_number_active_key.
        where: {
          buildingId: buildingRef.id,
          unitNumber: { equals: unit.unitNumber, mode: 'insensitive' },
          deletedAt: null,
        },
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
    duplicateContracts: DuplicateTracker,
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
      // A DMT PDF is a signed, executed tenancy contract, not a draft — without
      // this it would fall through to CreateContractDto's DRAFT default. ACTIVE
      // is also what makes the occupancy recompute and the overlap rule apply.
      // EXPIRED/EXPIRING_SOON are computed from the dates, never stored, so an
      // already-ended contract still stores ACTIVE and simply reads as expired.
      status: ContractStatus.ACTIVE,
      notes: result.contract.notes,
    };

    const { errors: dtoErrors, value } = await validateAgainstDto(CreateContractDto, plain);

    await this.checkContractDuplicates(
      result.contract.contractNumber,
      rowNumber,
      firstUnitRef,
      result.contract.startDate,
      result.contract.endDate,
      duplicateContracts,
      errors,
    );

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

  /**
   * Blocks a contract that already exists, so re-uploading the same PDF (or the
   * same contract twice in one batch) can't create a second copy. Contracts are
   * the only entity here without a natural reuse path — a repeated building or
   * tenant links to the existing record, but a repeated contract is duplicate data.
   *
   * Reported at preview time so the row shows as ERROR and is simply skipped at
   * commit, rather than surfacing as a mid-transaction failure.
   */
  private async checkContractDuplicates(
    contractNumber: string,
    rowNumber: number,
    unitRef: EntityRef,
    startDate: string,
    endDate: string,
    duplicateContracts: DuplicateTracker,
    errors: { field: string; message: string }[],
  ): Promise<void> {
    const key = normalizeKey(contractNumber);

    const firstRow = duplicateContracts.check(key, rowNumber);
    if (firstRow !== null) {
      errors.push({
        field: 'contractNumber',
        message: `Duplicate Contract Number '${contractNumber}' — already used by row ${firstRow} in this batch`,
      });
      return;
    }

    // Case-insensitive so it agrees with the in-batch key above, which is
    // normalized — otherwise 'abc-1' and 'ABC-1' would count as duplicates
    // within a batch but as two different contracts against the database.
    const existing = await this.prisma.contract.findFirst({
      where: { contractNumber: { equals: contractNumber, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) {
      errors.push({
        field: 'contractNumber',
        message: `Contract Number '${contractNumber}' already exists — this contract has already been imported`,
      });
      return;
    }

    // Overlap can only pre-exist against a property already in the DB; a pending
    // one has no contracts yet. ContractsService.create() re-checks at commit for
    // real (and catches two rows in this same batch that would overlap each other).
    if (!unitRef.id) return;

    const conflict = await this.prisma.contract.findFirst({
      where: {
        propertyId: unitRef.id,
        status: ContractStatus.ACTIVE,
        deletedAt: null,
        startDate: { lte: new Date(endDate) },
        endDate: { gte: new Date(startDate) },
      },
    });
    if (conflict) {
      errors.push({
        field: 'status',
        message: `Property already has an active contract (${conflict.contractNumber}) overlapping these dates`,
      });
    }
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

/**
 * A building code reduced to its identifying parts, order-independent:
 * 'R6-MZW16', 'MZW16-R6', 'mzw16 / r6' and 'R6_MZW16' all collapse to the same key.
 *
 * DMT prints the plot and sector as separate fields, and the two get written in
 * either order depending on who entered the building first. Comparing the raw
 * string meant a PDF for a building already registered as 'R6-MZW16' derived
 * 'MZW16-R6', matched nothing, and registered the same building a second time.
 * Sorting the parts makes that impossible in either direction.
 */
function canonicalBuildingKey(code: string): string {
  return code
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('-');
}

/**
 * How a tenant is identified for dedupe, strongest identifier first:
 * trade licence (company) → Emirates ID → passport → name.
 *
 * Name is the last resort, and a poor one in both directions: two different
 * people who share a name would be merged into one tenant, and one person whose
 * name is spelled differently across two PDFs would be duplicated. Now that the
 * extraction captures Emirates ID and passport (see ExtractedTenantDto), an
 * individual normally matches on a real identifier instead.
 *
 * The `where` clause deliberately mirrors the key so the in-batch cache and the
 * DB lookup can never disagree about whether two tenants are the same person.
 */
function tenantIdentity(tenant: {
  tradeLicenseNumber?: string;
  emiratesIdNumber?: string;
  passportNumber?: string;
  nameEn: string;
}): { key: string; where: Prisma.TenantWhereInput } {
  if (tenant.tradeLicenseNumber?.trim()) {
    const value = tenant.tradeLicenseNumber.trim();
    return { key: `trade:${normalizeKey(value)}`, where: { tradeLicenseNumber: value } };
  }
  if (tenant.emiratesIdNumber?.trim()) {
    const value = tenant.emiratesIdNumber.trim();
    return { key: `eid:${normalizeKey(value)}`, where: { emiratesIdNumber: value } };
  }
  if (tenant.passportNumber?.trim()) {
    const value = tenant.passportNumber.trim();
    return { key: `passport:${normalizeKey(value)}`, where: { passportNumber: value } };
  }
  return {
    key: `name:${normalizeKey(tenant.nameEn)}`,
    where: { nameEn: { equals: tenant.nameEn, mode: 'insensitive' } },
  };
}

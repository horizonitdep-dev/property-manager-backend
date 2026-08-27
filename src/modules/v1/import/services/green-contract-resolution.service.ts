import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { BuildingType } from '../../../../common/enums/building-type.enum';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { TenantType } from '../../../../common/enums/tenant-type.enum';
import { CreateBuildingDto } from '../../buildings/dtos/create-building.dto';
import { CreatePropertyDto } from '../../properties/dtos/create-property.dto';
import { CreateTenantDto } from '../../tenants/dtos/create-tenant.dto';
import { CreateContractDto } from '../../contracts/dtos/create-contract.dto';
import { ExtractedGreenContractResult } from '../green-contract-extraction-result';
import { RowResult } from '../row-result';
import {
  PAYMENT_FREQUENCY_LABELS,
  TENANT_TYPE_LABELS,
  UNIT_TYPE_LABELS,
} from '../enum-label-maps';
import { buildRowResult, mapEnumLabel, validateAgainstDto } from './importers/import-cell.utils';
import { missingRequiredTenantFields } from '../pdf-tenant-import-fields';
import { buildingCodeComponents, tenantMatchKey } from '../identity-normalization';

/**
 * Placeholder UUID standing in for a parent created earlier in the SAME batch,
 * which therefore has no real id until commit. Satisfies the DTOs' @IsUUID()
 * during preview only; GreenContractImportService swaps it for the real id at
 * commit time. Mirrors the DMT path's PENDING_ID_PLACEHOLDER.
 */
export const GREEN_PENDING_ID = '00000000-0000-0000-0000-000000000000';

/** The default unit type for a Green Contract, which never states one. */
const DEFAULT_UNIT_TYPE = 'Apartment';

export interface GreenExtractionWithRowNumber {
  result: ExtractedGreenContractResult;
  rowNumber: number;
}

export interface GreenKeyedRows {
  rows: RowResult[];
  /** keys[i] is the dedupe key for rows[i]. */
  keys: string[];
}

export interface GreenBatchResolution {
  buildings: GreenKeyedRows;
  properties: GreenKeyedRows;
  tenants: GreenKeyedRows;
  contracts: RowResult[];
}

/** Why a contract row cannot be committed (spec §6). */
export interface GreenDuplicateBlock {
  code: 'PROPERTY_HAS_EXISTING_CONTRACT' | 'DUPLICATE_UNIT_IN_BATCH';
  message: string;
  existingContractId?: string;
  existingContractNumber?: string;
  existingContractStatus?: string;
}

@Injectable()
export class GreenContractResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves each extracted Green Contract against the DB, deduping within the
   * batch, and applies the strict duplicate rule from §6.
   */
  async resolveBatch(extractions: GreenExtractionWithRowNumber[]): Promise<GreenBatchResolution> {
    const buildingResolver = new EntityResolver();
    const tenantResolver = new EntityResolver();
    const propertyResolver = new EntityResolver();

    const buildingRows: RowResult[] = [];
    const buildingKeys: string[] = [];
    const propertyRows: RowResult[] = [];
    const propertyKeys: string[] = [];
    const tenantRows: RowResult[] = [];
    const tenantKeys: string[] = [];
    const contractRows: RowResult[] = [];

    // Which batch row first targeted a given unit, so the second one can name it.
    const unitClaimedByRow = new Map<string, number>();

    const tenantIndex = await this.buildTenantIndex();

    for (const { result, rowNumber } of extractions) {
      const buildingRef = await this.resolveBuilding(result, rowNumber, buildingResolver, buildingRows, buildingKeys);

      // An ambiguous building poisons everything downstream — the unit, and
      // therefore the duplicate check, would be resolved against the wrong
      // building. Stop the row here rather than create candidates we would have
      // to unpick.
      if (buildingRef.ambiguousCodes) {
        contractRows.push(
          buildRowResult(rowNumber, {}, [
            {
              field: 'buildingId',
              message:
                `Building code "${result.building.code}" matches more than one building ` +
                `(${buildingRef.ambiguousCodes.join(', ')}). Pick the right one and set it on the ` +
                'contract manually, or make the codes unambiguous.',
            },
          ]),
        );
        continue;
      }

      const propertyRef = await this.resolveProperty(
        result,
        rowNumber,
        buildingRef,
        propertyResolver,
        propertyRows,
        propertyKeys,
      );
      const tenantRef = await this.resolveTenant(
        result,
        rowNumber,
        tenantResolver,
        tenantRows,
        tenantKeys,
        tenantIndex,
      );

      contractRows.push(
        await this.buildContractRow(result, rowNumber, tenantRef, propertyRef, unitClaimedByRow),
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
   * §7.1 — resolve the building, never creating a second record for one that
   * already exists. Never fabricate a PRP.
   *
   * Two-step, because the two ingestion paths name the same building differently:
   * a DMT contract yields a composite code built from Plot + Sector (`R6-MZW16`),
   * while a Green Contract only ever carries the plot (`R6`). Exact matching alone
   * therefore misses the existing building and creates a duplicate — which then
   * gives the unit a fresh, contract-free property and silently bypasses the
   * duplicate-contract rule in §6.
   *
   *   1. exact match on code (case-insensitive)
   *   2. component match — `R6` matches `MZW16-R6`, because R6 is one of its parts
   *   3. no match at all -> create a candidate
   *
   * A component match that hits more than one building is genuinely ambiguous
   * (`R6` under two different sectors). Rather than guess, the row is blocked so
   * a human picks — guessing here would attach a contract to the wrong building,
   * which is worse than not importing it.
   */
  private async resolveBuilding(
    result: ExtractedGreenContractResult,
    rowNumber: number,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
  ): Promise<EntityRef> {
    const code = result.building.code;
    const key = normalizeKey(code);
    const cached = resolver.get(key);
    if (cached) return cached;

    const exact = await this.prisma.building.findFirst({
      where: { code: { equals: code, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (exact) {
      const ref: EntityRef = { id: exact.id };
      resolver.set(key, ref);
      return ref;
    }

    const componentMatches = await this.findByCodeComponent(code);
    if (componentMatches.length === 1) {
      const ref: EntityRef = { id: componentMatches[0].id };
      resolver.set(key, ref);
      return ref;
    }
    if (componentMatches.length > 1) {
      const ref: EntityRef = { ambiguousCodes: componentMatches.map((b) => b.code) };
      resolver.set(key, ref);
      return ref;
    }

    const plain: Record<string, unknown> = {
      name: result.building.name,
      code,
      address: 'Address not on the contract — please complete',
      city: 'Abu Dhabi',
      buildingType: mapEnumLabel('Residential', {
        residential: BuildingType.RESIDENTIAL,
        commercial: BuildingType.COMMERCIAL,
      }),
      totalFloors: 1,
      // propertyRegistrationNo deliberately omitted — a Green Contract has none
      // and inventing one would corrupt DMT matching later (§7.1).
      notes: 'Created from a Green Contract import — please confirm address, floors and type.',
    };
    const { errors, value } = await validateAgainstDto(CreateBuildingDto, plain);

    outRows.push(buildRowResult(rowNumber, value as unknown as Record<string, unknown>, errors));
    outKeys.push(key);
    const ref: EntityRef = { pendingIndex: outRows.length - 1 };
    resolver.set(key, ref);
    return ref;
  }

  /**
   * Every live tenant keyed by normalised identity, loaded once per batch.
   *
   * Built in memory rather than queried per row because matching happens on the
   * NORMALISED value: "784-1990-3780179-4" and "784199037801794" are the same
   * person, and no SQL predicate on the stored column can see that. One pass
   * over the tenant table also replaces one query per contract in the batch.
   */
  private async buildTenantIndex(): Promise<Map<string, string>> {
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, emiratesIdNumber: true, tradeLicenseNumber: true, nameEn: true },
      orderBy: { createdAt: 'asc' },
    });

    const index = new Map<string, string>();
    for (const tenant of tenants) {
      const key = tenantMatchKey(tenant);
      // Oldest wins, so an import attaches to the original record rather than a
      // later duplicate that may already exist in the data.
      if (!index.has(key)) index.set(key, tenant.id);
    }
    return index;
  }

  /**
   * Buildings whose code contains the given token as a whole component.
   *
   * The candidate set is narrowed in SQL with a substring filter, then filtered
   * properly in JS on component equality — otherwise `R6` would also match
   * `R60` or `AR6`, quietly linking a contract to the wrong building.
   */
  private async findByCodeComponent(code: string): Promise<{ id: string; code: string }[]> {
    const token = code.trim().toUpperCase();

    const candidates = await this.prisma.building.findMany({
      where: { code: { contains: token, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
    });

    return candidates.filter((b) => buildingCodeComponents(b.code).includes(token));
  }

  /** §7.2 — match by (buildingId, unitNumber). */
  private async resolveProperty(
    result: ExtractedGreenContractResult,
    rowNumber: number,
    buildingRef: EntityRef,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
  ): Promise<EntityRef> {
    const unitNumber = result.unit.unitNumber;
    const buildingKey = buildingRef.id ?? normalizeKey(result.building.code);
    const key = `${buildingKey}::${normalizeKey(unitNumber)}`;
    const cached = resolver.get(key);
    if (cached) return cached;

    if (buildingRef.id) {
      const existing = await this.prisma.property.findFirst({
        where: {
          buildingId: buildingRef.id,
          unitNumber: { equals: unitNumber, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        const ref: EntityRef = { id: existing.id };
        resolver.set(key, ref);
        return ref;
      }
    }

    const plain: Record<string, unknown> = {
      unitNumber,
      buildingId: buildingRef.id ?? GREEN_PENDING_ID,
      floor: 1,
      unitType: mapEnumLabel(DEFAULT_UNIT_TYPE, UNIT_TYPE_LABELS),
      monthlyRent: result.contract.monthlyRent,
      notes: 'Created from a Green Contract import — please confirm floor and unit type.',
    };
    const { errors, value } = await validateAgainstDto(CreatePropertyDto, plain);

    outRows.push(
      buildRowResult(rowNumber, value as unknown as Record<string, unknown>, errors, {
        buildingId: entityRefToken(buildingRef, 'building'),
      }),
    );
    outKeys.push(key);
    const ref: EntityRef = { pendingIndex: outRows.length - 1 };
    resolver.set(key, ref);
    return ref;
  }

  /**
   * §7.3 — dedup by trade licence (company) or Emirates ID (individual), then name.
   *
   * Matched on NORMALISED identity, not the raw string: the same person is written
   * "784-1990-3780179-4" by one source and "784199037801794" by another, and an
   * exact comparison would create a second tenant for someone already on file.
   */
  private async resolveTenant(
    result: ExtractedGreenContractResult,
    rowNumber: number,
    resolver: EntityResolver,
    outRows: RowResult[],
    outKeys: string[],
    tenantIndex: Map<string, string>,
  ): Promise<EntityRef> {
    const key = tenantMatchKey({
      emiratesIdNumber: result.tenant.emiratesIdNumber,
      tradeLicenseNumber: result.tenant.tradeLicenseNumber,
      nameEn: result.tenant.nameEn,
    });

    const cached = resolver.get(key);
    if (cached) return cached;

    const existingId = tenantIndex.get(key);
    if (existingId) {
      const ref: EntityRef = { id: existingId };
      resolver.set(key, ref);
      return ref;
    }

    const tenantType = mapEnumLabel(result.tenant.tenantType, TENANT_TYPE_LABELS) ?? undefined;
    const plain: Record<string, unknown> = {
      tenantType,
      nameEn: result.tenant.nameEn,
      nameAr: result.tenant.nameAr,
      phone: result.tenant.phone,
      emiratesIdNumber: result.tenant.emiratesIdNumber,
      tradeLicenseNumber: result.tenant.tradeLicenseNumber,
      authorizedPersonNameEn: result.tenant.authorizedPersonNameEn,
      authorizedPersonNameAr: result.tenant.authorizedPersonNameAr,
    };
    const { errors, value } = await validateAgainstDto(CreateTenantDto, plain);

    // CreateTenantDto pairs @RequiredForTenantType with @ValidateIf, so an ABSENT
    // conditional field slips past the DTO but is still rejected by
    // TenantsService at commit. Run the same check the service will run, or a row
    // previews VALID and then fails the commit. Same reasoning as the DMT path.
    for (const field of missingRequiredTenantFields(value as unknown as Record<string, unknown>)) {
      errors.push({ field, message: `${field} is required when tenantType is ${tenantType}` });
    }

    outRows.push(buildRowResult(rowNumber, value as unknown as Record<string, unknown>, errors));
    outKeys.push(key);
    const ref: EntityRef = { pendingIndex: outRows.length - 1 };
    resolver.set(key, ref);
    return ref;
  }

  private async buildContractRow(
    result: ExtractedGreenContractResult,
    rowNumber: number,
    tenantRef: EntityRef,
    propertyRef: EntityRef,
    unitClaimedByRow: Map<string, number>,
  ): Promise<RowResult> {
    const errors: { field: string; message: string }[] = [];
    const c = result.contract;

    const paymentFrequency = mapEnumLabel(c.paymentFrequency, PAYMENT_FREQUENCY_LABELS) ?? undefined;
    if (!paymentFrequency) {
      errors.push({
        field: 'paymentFrequency',
        message: `Payment Frequency '${c.paymentFrequency}' is not recognized`,
      });
    }

    const plain: Record<string, unknown> = {
      contractNumber: c.contractNumber,
      tenantId: tenantRef.id ?? GREEN_PENDING_ID,
      propertyId: propertyRef.id ?? GREEN_PENDING_ID,
      startDate: c.startDate,
      endDate: c.endDate,
      annualRent: c.annualRent,
      monthlyRent: c.monthlyRent,
      paymentFrequency,
      numberOfCheques: c.numberOfCheques,
      // A signed Green Contract is in force, not a draft.
      status: ContractStatus.ACTIVE,
      notes: c.notes,
    };

    const { errors: dtoErrors, value } = await validateAgainstDto(CreateContractDto, plain);
    errors.push(...dtoErrors);

    const block = await this.checkDuplicate(result, propertyRef, rowNumber, unitClaimedByRow);
    if (block) {
      errors.push({ field: 'propertyId', message: block.message });
    }

    return buildRowResult(
      rowNumber,
      value as unknown as Record<string, unknown>,
      errors,
      {
        tenantId: entityRefToken(tenantRef, 'tenant'),
        propertyId: entityRefToken(propertyRef, 'property'),
        ...(block ? { duplicateBlock: JSON.stringify(block) } : {}),
      },
    );
  }

  /**
   * §6, the strict one-directional rule.
   *
   * A Green Contract is refused for any unit that already has a non-deleted
   * contract — any source, any status. DMT is authoritative wherever it exists,
   * even as history, so a Green PDF for such a unit adds nothing. Soft-deleted
   * contracts do not count.
   *
   * A brand-new unit (created in this same batch) has no id yet and therefore no
   * contracts, so only the in-batch collision check applies to it.
   */
  private async checkDuplicate(
    result: ExtractedGreenContractResult,
    propertyRef: EntityRef,
    rowNumber: number,
    unitClaimedByRow: Map<string, number>,
  ): Promise<GreenDuplicateBlock | null> {
    const unitLabel = `${result.building.code}-${result.unit.unitNumber}`;
    const batchKey = normalizeKey(unitLabel);

    const claimedBy = unitClaimedByRow.get(batchKey);
    if (claimedBy !== undefined) {
      return {
        code: 'DUPLICATE_UNIT_IN_BATCH',
        message: `Two PDFs in this batch target unit ${unitLabel} (also row ${claimedBy}) — remove one.`,
      };
    }
    unitClaimedByRow.set(batchKey, rowNumber);

    if (!propertyRef.id) return null;

    const existing = await this.prisma.contract.findFirst({
      where: { propertyId: propertyRef.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, contractNumber: true, status: true },
    });
    if (!existing) return null;

    return {
      code: 'PROPERTY_HAS_EXISTING_CONTRACT',
      message:
        `Unit ${unitLabel} already has a contract (${existing.contractNumber}, status ${existing.status}). ` +
        'Green Contracts cannot be imported for units that already have a contract on file. ' +
        'If any details differ, edit the existing contract directly.',
      existingContractId: existing.id,
      existingContractNumber: existing.contractNumber,
      existingContractStatus: existing.status,
    };
  }
}

interface EntityRef {
  id?: string;
  pendingIndex?: number;
  /** Set when the Green code matched several buildings and a human must choose. */
  ambiguousCodes?: string[];
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
 * Tenant identity, strongest first: trade licence (company), Emirates ID
 * (individual), then name. Name is a weak last resort — it merges two different
 * people who share one, and splits one person spelled two ways — so it is only
 * reached when the contract carries no identifier at all.
 */
function greenTenantIdentity(tenant: {
  tradeLicenseNumber?: string;
  emiratesIdNumber?: string;
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
  return {
    key: `name:${normalizeKey(tenant.nameEn)}`,
    where: { nameEn: { equals: tenant.nameEn, mode: 'insensitive' } },
  };
}

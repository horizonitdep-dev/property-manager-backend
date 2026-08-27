import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { StorageService } from '../../../../shared/storage/storage.service';
import { BuildingsService } from '../../buildings/buildings.service';
import { PropertiesService } from '../../properties/properties.service';
import { TenantsService } from '../../tenants/tenants.service';
import { ContractsService } from '../../contracts/contracts.service';
import { CreateBuildingDto } from '../../buildings/dtos/create-building.dto';
import { CreatePropertyDto } from '../../properties/dtos/create-property.dto';
import { CreateTenantDto } from '../../tenants/dtos/create-tenant.dto';
import { CreateContractDto } from '../../contracts/dtos/create-contract.dto';
import { exemptFieldsForTenantType } from '../pdf-tenant-import-fields';
import { ContractSource } from '../../../../common/enums/contract-source.enum';
import { ContractDocumentType } from '../../../../common/enums/contract-document-type.enum';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { ImportSessionType } from '../../../../common/enums/import-session-type.enum';
import { ImportStatus } from '../../../../common/enums/import-status.enum';
import { RowResult } from '../row-result';
import { ImportCommitRowError } from '../import-commit-row.error';
import { GreenContractExtractionError } from '../green-contract-extraction.error';
import { GreenContractExtractionService } from './green-contract-extraction.service';
import {
  GreenContractResolutionService,
  GreenExtractionWithRowNumber,
} from './green-contract-resolution.service';

export const MAX_GREEN_FILES_PER_BATCH = 10;
export const MAX_GREEN_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Modest parallelism — respects Anthropic rate limits and keeps cost predictable (§5.6). */
const EXTRACTION_CONCURRENCY = 3;

export interface GreenBatchFailure {
  fileName: string;
  reason: string;
}

export interface GreenCommitContractFailure {
  rowNumber: number;
  reason: string;
}

interface GreenSourceFile {
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Everything about the batch lives in the single session's rowsData: unlike the
 * DMT path there is no fan-out into four sessions, so one Green Contract upload
 * is exactly one ImportSession.
 */
interface GreenBatchPayload {
  kind: 'green-contract-batch';
  failures: GreenBatchFailure[];
  buildingRows: RowResult[];
  propertyRows: RowResult[];
  tenantRows: RowResult[];
  contractRows: RowResult[];
  sourceFiles: Record<number, GreenSourceFile>;
  /** Raw model output per row, kept for auditing (§5.6). */
  rawExtractions: Record<number, unknown>;
}

export interface GreenBatchPreview {
  sessionId: string;
  failures: GreenBatchFailure[];
  summary: {
    pdfsUploaded: number;
    pdfsExtracted: number;
    pdfsFailed: number;
    candidateBuildings: number;
    candidateProperties: number;
    candidateTenants: number;
    candidateContracts: number;
    blockedContracts: number;
  };
  buildingRows: RowResult[];
  propertyRows: RowResult[];
  tenantRows: RowResult[];
  contractRows: RowResult[];
}

export interface GreenBatchCommitResult {
  buildingsCreated: number;
  propertiesCreated: number;
  tenantsCreated: number;
  contractsCreated: number;
  contractIds: string[];
  contractFailures: GreenCommitContractFailure[];
}

/** See the DMT equivalent — Nest hides array payloads behind a generic `.message`. */
function describeCommitError(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse() as unknown;
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      const { message } = response as { message?: unknown };
      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
    }
  }
  return (error as Error).message;
}

@Injectable()
export class GreenContractImportService {
  private readonly logger = new Logger(GreenContractImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly extractionService: GreenContractExtractionService,
    private readonly resolutionService: GreenContractResolutionService,
    private readonly buildingsService: BuildingsService,
    private readonly propertiesService: PropertiesService,
    private readonly tenantsService: TenantsService,
    private readonly contractsService: ContractsService,
  ) {}

  async validate(files: Express.Multer.File[], userId: string): Promise<GreenBatchPreview> {
    this.assertBatchLimits(files);

    const failures: GreenBatchFailure[] = [];
    const extractions: GreenExtractionWithRowNumber[] = [];
    const sourceFiles: Record<number, GreenSourceFile> = {};
    const rawExtractions: Record<number, unknown> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let rowNumber = 1;

    for (const group of chunk(files, EXTRACTION_CONCURRENCY)) {
      const outcomes = await Promise.allSettled(
        group.map((file) => this.extractionService.extract(file.buffer, file.originalname)),
      );

      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i];
        const file = group[i];

        if (outcome.status === 'rejected') {
          // One unparseable PDF must not sink the batch (§5.6).
          const reason =
            outcome.reason instanceof GreenContractExtractionError
              ? outcome.reason.reason
              : (outcome.reason as Error).message;
          failures.push({ fileName: file.originalname, reason });
          continue;
        }

        const currentRow = rowNumber++;
        extractions.push({ result: outcome.value, rowNumber: currentRow });
        rawExtractions[currentRow] = outcome.value.rawExtraction;
        totalInputTokens += outcome.value.usage.inputTokens;
        totalOutputTokens += outcome.value.usage.outputTokens;

        // Stage the bytes now: the multer buffer is gone once this request ends,
        // and commit() is a separate request that needs them to attach the PDF.
        // A staging failure must not fail the batch — the row just commits
        // without its source document.
        try {
          const fileKey = `green-contracts/staging/${randomUUID()}-${sanitizeFileName(file.originalname)}`;
          await this.storage.uploadFile(fileKey, file.buffer, 'application/pdf');
          sourceFiles[currentRow] = {
            fileKey,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: 'application/pdf',
          };
        } catch (error) {
          this.logger.warn(
            `Failed to stage Green Contract PDF ${file.originalname}: ${(error as Error).message}`,
          );
        }
      }
    }

    const resolved = await this.resolutionService.resolveBatch(extractions);

    const payload: GreenBatchPayload = {
      kind: 'green-contract-batch',
      failures,
      buildingRows: resolved.buildings.rows,
      propertyRows: resolved.properties.rows,
      tenantRows: resolved.tenants.rows,
      contractRows: resolved.contracts,
      sourceFiles,
      rawExtractions,
    };

    const validContracts = resolved.contracts.filter((r) => r.status === 'VALID').length;
    const session = await this.prisma.importSession.create({
      data: {
        module: ImportModule.CONTRACTS,
        sessionType: ImportSessionType.R6_GREEN_CONTRACT,
        originalName: files.map((f) => f.originalname).join(', '),
        totalRows: resolved.contracts.length,
        validRows: validContracts,
        errorRows: resolved.contracts.length - validContracts,
        rowsData: payload as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    this.logger.log('Green Contract batch validated', {
      sessionId: session.id,
      pdfsUploaded: files.length,
      pdfsExtracted: extractions.length,
      pdfsFailed: failures.length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      userId,
      action: 'VALIDATE_GREEN_CONTRACT_BATCH',
    });

    return {
      sessionId: session.id,
      failures,
      summary: {
        pdfsUploaded: files.length,
        pdfsExtracted: extractions.length,
        pdfsFailed: failures.length,
        candidateBuildings: resolved.buildings.rows.length,
        candidateProperties: resolved.properties.rows.length,
        candidateTenants: resolved.tenants.rows.length,
        candidateContracts: resolved.contracts.length,
        blockedContracts: resolved.contracts.length - validContracts,
      },
      buildingRows: resolved.buildings.rows,
      propertyRows: resolved.properties.rows,
      tenantRows: resolved.tenants.rows,
      contractRows: resolved.contracts,
    };
  }

  async findOne(sessionId: string): Promise<GreenBatchPreview> {
    const { session, payload } = await this.loadSession(sessionId);
    const validContracts = payload.contractRows.filter((r) => r.status === 'VALID').length;

    return {
      sessionId: session.id,
      failures: payload.failures,
      summary: {
        pdfsUploaded: payload.contractRows.length + payload.failures.length,
        pdfsExtracted: payload.contractRows.length,
        pdfsFailed: payload.failures.length,
        candidateBuildings: payload.buildingRows.length,
        candidateProperties: payload.propertyRows.length,
        candidateTenants: payload.tenantRows.length,
        candidateContracts: payload.contractRows.length,
        blockedContracts: payload.contractRows.length - validContracts,
      },
      buildingRows: payload.buildingRows,
      propertyRows: payload.propertyRows,
      tenantRows: payload.tenantRows,
      contractRows: payload.contractRows,
    };
  }

  /**
   * Two-phase commit, for the same reason the DMT path uses one:
   * ContractsService.create() verifies tenant and property existence through
   * services that do not accept a transaction client, so those checks run on a
   * separate connection and cannot see writes from an open transaction. Phase 1
   * commits the parents; phase 2 then creates contracts that can actually see them.
   */
  async commit(sessionId: string, userId: string): Promise<GreenBatchCommitResult> {
    const { session, payload } = await this.loadSession(sessionId);

    if (session.status === ImportStatus.COMMITTED) {
      throw new ConflictException('This Green Contract batch has already been committed');
    }

    const validContracts = payload.contractRows.filter((r) => r.status === 'VALID');
    if (validContracts.length === 0) {
      throw new BadRequestException(
        'This batch has no committable rows — every contract was blocked or failed validation',
      );
    }

    const buildingIdByIndex = new Map<number, string>();
    const propertyIdByIndex = new Map<number, string>();
    const tenantIdByIndex = new Map<number, string>();

    try {
      await this.prisma.$transaction(async (tx) => {
        const client = tx as Prisma.TransactionClient;

        for (let i = 0; i < payload.buildingRows.length; i++) {
          const row = payload.buildingRows[i];
          if (row.status !== 'VALID') continue;
          try {
            const created = await this.buildingsService.create(
              row.data as unknown as CreateBuildingDto,
              userId,
              client,
            );
            buildingIdByIndex.set(i, created.id);
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[building] ${describeCommitError(error)}`);
          }
        }

        for (let i = 0; i < payload.propertyRows.length; i++) {
          const row = payload.propertyRows[i];
          if (row.status !== 'VALID') continue;

          let buildingId: string;
          try {
            buildingId = resolvePendingRef(
              row.resolvedRefs?.buildingId ?? String(row.data.buildingId ?? ''),
              buildingIdByIndex,
              'building',
            );
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[property] ${describeCommitError(error)}`);
          }

          try {
            const created = await this.propertiesService.create(
              { ...(row.data as Record<string, unknown>), buildingId } as unknown as CreatePropertyDto,
              userId,
              client,
            );
            propertyIdByIndex.set(i, created.id);
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[property] ${describeCommitError(error)}`);
          }
        }

        for (let i = 0; i < payload.tenantRows.length; i++) {
          const row = payload.tenantRows[i];
          if (row.status !== 'VALID') continue;
          try {
            const created = await this.tenantsService.create(
              row.data as unknown as CreateTenantDto,
              userId,
              client,
              // Company tenants routinely lack licence expiry / authorized person on
              // a Green Contract; they import flagged incomplete rather than blocked (§3).
              exemptFieldsForTenantType((row.data as Record<string, unknown>).tenantType),
            );
            tenantIdByIndex.set(i, created.id);
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[tenant] ${describeCommitError(error)}`);
          }
        }
      });
    } catch (error) {
      await this.prisma.importSession.update({
        where: { id: sessionId },
        data: { status: ImportStatus.FAILED },
      });

      if (error instanceof ImportCommitRowError) {
        throw new ConflictException(
          `Commit failed at row ${error.rowNumber}: ${error.reason}. No buildings/properties/tenants ` +
            'were created (transaction rolled back); contracts were not attempted.',
        );
      }
      throw error;
    }

    const contractFailures: GreenCommitContractFailure[] = [];
    const contractIds: string[] = [];

    for (const row of validContracts) {
      let tenantId: string;
      let propertyId: string;
      try {
        tenantId = resolvePendingRef(row.resolvedRefs?.tenantId ?? '', tenantIdByIndex, 'tenant');
        propertyId = resolvePendingRef(row.resolvedRefs?.propertyId ?? '', propertyIdByIndex, 'property');
      } catch (error) {
        contractFailures.push({ rowNumber: row.rowNumber, reason: describeCommitError(error) });
        continue;
      }

      const dto = { ...(row.data as Record<string, unknown>), tenantId, propertyId } as unknown as CreateContractDto;

      try {
        const created = await this.contractsService.create(
          dto,
          userId,
          undefined,
          ContractSource.R6_GREEN_CONTRACT,
        );
        contractIds.push(created.id);

        const sourceFile = payload.sourceFiles?.[row.rowNumber];
        if (sourceFile) {
          try {
            await this.prisma.contractDocument.create({
              data: {
                contractId: created.id,
                documentType: ContractDocumentType.SIGNED_CONTRACT,
                fileName: sourceFile.fileName,
                fileKey: sourceFile.fileKey,
                fileSize: sourceFile.fileSize,
                mimeType: sourceFile.mimeType,
                uploadedById: userId,
              },
            });
          } catch (error) {
            // The contract is committed; losing the attachment must not undo it.
            this.logger.warn(
              `Contract ${created.id} committed but its source PDF could not be attached: ${describeCommitError(error)}`,
            );
          }
        }
      } catch (error) {
        contractFailures.push({ rowNumber: row.rowNumber, reason: describeCommitError(error) });
      }
    }

    await this.prisma.importSession.update({
      where: { id: sessionId },
      data: { status: ImportStatus.COMMITTED, committedAt: new Date() },
    });

    this.logger.log('Green Contract batch committed', {
      sessionId,
      contractsCreated: contractIds.length,
      contractFailures: contractFailures.length,
      userId,
      action: 'COMMIT_GREEN_CONTRACT_BATCH',
    });

    return {
      buildingsCreated: buildingIdByIndex.size,
      propertiesCreated: propertyIdByIndex.size,
      tenantsCreated: tenantIdByIndex.size,
      contractsCreated: contractIds.length,
      contractIds,
      contractFailures,
    };
  }

  /**
   * Loads a session and refuses one belonging to another importer (§9), so a DMT
   * or CSV session id can never be run through the Green normalization.
   */
  private async loadSession(sessionId: string) {
    const session = await this.prisma.importSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Green Contract import session not found');
    }
    if (session.sessionType !== ImportSessionType.R6_GREEN_CONTRACT) {
      throw new BadRequestException(
        `Session ${sessionId} belongs to the ${session.sessionType} importer, not the Green Contract importer`,
      );
    }

    const payload = session.rowsData as unknown as GreenBatchPayload;
    if (!payload || payload.kind !== 'green-contract-batch') {
      throw new BadRequestException('Session is not a Green Contract batch');
    }

    return { session, payload };
  }

  private assertBatchLimits(files: Express.Multer.File[]): void {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one PDF is required');
    }
    if (files.length > MAX_GREEN_FILES_PER_BATCH) {
      throw new BadRequestException(
        `Too many files — a batch is limited to ${MAX_GREEN_FILES_PER_BATCH} PDFs`,
      );
    }
    for (const file of files) {
      if (file.mimetype !== 'application/pdf') {
        throw new BadRequestException(`${file.originalname} is not a PDF`);
      }
      if (file.size > MAX_GREEN_FILE_SIZE_BYTES) {
        throw new BadRequestException(`${file.originalname} exceeds the 10 MB size limit`);
      }
    }
  }
}

/** Swaps a `pending:<kind>:<index>` token for the id created during phase 1. */
function resolvePendingRef(
  token: string,
  createdIdByIndex: Map<number, string>,
  kind: 'building' | 'property' | 'tenant',
): string {
  if (!token) {
    throw new Error(`Missing ${kind} reference`);
  }
  const match = token.match(/^pending:(?:building|property|tenant):(\d+)$/);
  if (!match) return token;

  const resolved = createdIdByIndex.get(Number(match[1]));
  if (!resolved) {
    throw new Error(
      `Referenced ${kind} candidate row #${match[1]} was not created (invalid or skipped) — cannot commit this row`,
    );
  }
  return resolved;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

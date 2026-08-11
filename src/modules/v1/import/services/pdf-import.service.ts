import {
  BadRequestException,
  ConflictException,
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
import { IMPORT_OPTIONAL_COMPANY_FIELDS } from '../../tenants/validators/tenant-type-fields.validator';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { ImportStatus } from '../../../../common/enums/import-status.enum';
import { ContractDocumentType } from '../../../../common/enums/contract-document-type.enum';
import { RowResult } from '../row-result';
import { ImportCommitRowError } from '../import-commit-row.error';
import { PdfExtractionService } from './pdf-extraction.service';
import { PdfResolutionService } from './pdf-resolution.service';
import { PdfExtractionError } from '../pdf-extraction.error';

export const MAX_PDF_FILES_PER_BATCH = 10;
export const MAX_PDF_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Batch calls to the extraction API in small groups rather than one huge Promise.all
 * (spec §10: "make extraction concurrency configurable"). */
const EXTRACTION_CONCURRENCY = 3;

export interface PdfBatchFailure {
  fileName: string;
  reason: string;
}

export interface PdfCommitContractFailure {
  rowNumber: number;
  reason: string;
}

interface PdfSourceFile {
  fileKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/** Linkage metadata stashed inside the Contracts session's own rowsData JSON —
 * the Contracts session is always the last one in dependency order, so it
 * doubles as the anchor ("batch id") for the whole PDF upload. No schema
 * change needed: rowsData is already an untyped JSON column. */
interface PdfBatchLinkage {
  kind: 'pdf-batch';
  buildingsSessionId: string | null;
  propertiesSessionId: string | null;
  tenantsSessionId: string | null;
  failures: PdfBatchFailure[];
  rows: RowResult[];
  /** Keyed by contract row number — the original PDF bytes, already uploaded to
   * storage at validate time (multer buffers don't survive past that request),
   * so commit() can attach them to the Contract it creates without needing the
   * PDFs to be re-uploaded. Absent for a row if staging upload failed — commit
   * still proceeds, just without the attached source document (§10 graceful
   * degradation applies here too). */
  sourceFiles: Record<number, PdfSourceFile>;
}

export interface PdfBatchPreview {
  contractSessionId: string;
  buildingsSessionId: string | null;
  propertiesSessionId: string | null;
  tenantsSessionId: string | null;
  failures: PdfBatchFailure[];
  summary: {
    pdfsUploaded: number;
    pdfsExtracted: number;
    pdfsFailed: number;
    candidateBuildings: number;
    candidateProperties: number;
    candidateTenants: number;
    candidateContracts: number;
  };
  buildingRows: RowResult[];
  propertyRows: RowResult[];
  tenantRows: RowResult[];
  contractRows: RowResult[];
}

export interface PdfBatchCommitResult {
  buildingsCreated: number;
  propertiesCreated: number;
  tenantsCreated: number;
  contractsCreated: number;
  contractIds: string[];
  contractFailures: PdfCommitContractFailure[];
}

@Injectable()
export class PdfImportService {
  private readonly logger = new Logger(PdfImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly extractionService: PdfExtractionService,
    private readonly resolutionService: PdfResolutionService,
    private readonly buildingsService: BuildingsService,
    private readonly propertiesService: PropertiesService,
    private readonly tenantsService: TenantsService,
    private readonly contractsService: ContractsService,
  ) {}

  async validate(files: Express.Multer.File[], userId: string): Promise<PdfBatchPreview> {
    this.assertBatchLimits(files);

    const failures: PdfBatchFailure[] = [];
    const extractions: { result: Awaited<ReturnType<PdfExtractionService['extractContract']>>; rowNumber: number }[] =
      [];
    const sourceFiles: Record<number, PdfSourceFile> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let rowNumber = 1;

    for (const batch of chunk(files, EXTRACTION_CONCURRENCY)) {
      const outcomes = await Promise.allSettled(
        batch.map((file) => this.extractionService.extractContract(file.buffer, file.originalname)),
      );

      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i];
        const file = batch[i];

        if (outcome.status === 'fulfilled') {
          const currentRowNumber = rowNumber++;
          extractions.push({ result: outcome.value, rowNumber: currentRowNumber });
          totalInputTokens += outcome.value.usage.inputTokens;
          totalOutputTokens += outcome.value.usage.outputTokens;

          // Stage the source PDF now — the multer buffer is gone once this request
          // ends, but commit() (a later, separate request) needs the bytes to
          // attach the document to the Contract it creates. A staging failure
          // (e.g. storage not configured) shouldn't fail the whole batch — the
          // row just won't get a source document attached at commit time.
          try {
            const fileKey = `pdf-imports/staging/${randomUUID()}-${sanitizeFileName(file.originalname)}`;
            await this.storage.uploadFile(fileKey, file.buffer, 'application/pdf');
            sourceFiles[currentRowNumber] = {
              fileKey,
              fileName: file.originalname,
              fileSize: file.size,
              mimeType: 'application/pdf',
            };
          } catch (error) {
            this.logger.warn(
              `Failed to stage source PDF for ${file.originalname}: ${(error as Error).message}`,
            );
          }
        } else {
          const error = outcome.reason;
          const fileName = error instanceof PdfExtractionError ? error.fileName : file?.originalname ?? 'unknown file';
          const reason = error instanceof Error ? error.message : String(error);
          failures.push({ fileName, reason });
        }
      }
    }

    this.logger.log('PDF batch extraction complete', {
      pdfsUploaded: files.length,
      pdfsExtracted: extractions.length,
      pdfsFailed: failures.length,
      totalInputTokens,
      totalOutputTokens,
      userId,
      action: 'PDF_BATCH_EXTRACTION',
    });

    if (extractions.length === 0) {
      throw new BadRequestException(
        `No PDF could be extracted. Failures: ${failures.map((f) => `${f.fileName} (${f.reason})`).join('; ')}`,
      );
    }

    const resolved = await this.resolutionService.resolveBatch(extractions);

    const buildingsSessionId = await this.createLeafSession(
      ImportModule.BUILDINGS,
      resolved.buildings.rows,
      userId,
    );
    const propertiesSessionId = await this.createLeafSession(
      ImportModule.PROPERTIES,
      resolved.properties.rows,
      userId,
    );
    const tenantsSessionId = await this.createLeafSession(ImportModule.TENANTS, resolved.tenants.rows, userId);

    const linkage: PdfBatchLinkage = {
      kind: 'pdf-batch',
      buildingsSessionId,
      propertiesSessionId,
      tenantsSessionId,
      failures,
      rows: resolved.contracts,
      sourceFiles,
    };

    const validContractRows = resolved.contracts.filter((r) => r.status === 'VALID').length;
    const contractSession = await this.prisma.importSession.create({
      data: {
        module: ImportModule.CONTRACTS,
        originalName: files.map((f) => f.originalname).join(', '),
        totalRows: resolved.contracts.length,
        validRows: validContractRows,
        errorRows: resolved.contracts.length - validContractRows,
        rowsData: linkage as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    return {
      contractSessionId: contractSession.id,
      buildingsSessionId,
      propertiesSessionId,
      tenantsSessionId,
      failures,
      summary: {
        pdfsUploaded: files.length,
        pdfsExtracted: extractions.length,
        pdfsFailed: failures.length,
        candidateBuildings: resolved.buildings.rows.length,
        candidateProperties: resolved.properties.rows.length,
        candidateTenants: resolved.tenants.rows.length,
        candidateContracts: resolved.contracts.length,
      },
      buildingRows: resolved.buildings.rows,
      propertyRows: resolved.properties.rows,
      tenantRows: resolved.tenants.rows,
      contractRows: resolved.contracts,
    };
  }

  async findOne(contractSessionId: string): Promise<PdfBatchPreview> {
    const contractSession = await this.prisma.importSession.findUnique({ where: { id: contractSessionId } });
    if (!contractSession || contractSession.module !== ImportModule.CONTRACTS) {
      throw new NotFoundException('PDF import session not found');
    }

    const linkage = contractSession.rowsData as unknown as PdfBatchLinkage;
    if (!linkage || linkage.kind !== 'pdf-batch') {
      throw new NotFoundException('Session is not a PDF import batch');
    }

    const { buildingRows, propertyRows, tenantRows } = await this.loadLeafRows(linkage);

    return {
      contractSessionId,
      buildingsSessionId: linkage.buildingsSessionId,
      propertiesSessionId: linkage.propertiesSessionId,
      tenantsSessionId: linkage.tenantsSessionId,
      failures: linkage.failures,
      summary: {
        pdfsUploaded: linkage.rows.length + linkage.failures.length,
        pdfsExtracted: linkage.rows.length,
        pdfsFailed: linkage.failures.length,
        candidateBuildings: buildingRows.length,
        candidateProperties: propertyRows.length,
        candidateTenants: tenantRows.length,
        candidateContracts: linkage.rows.length,
      },
      buildingRows,
      propertyRows,
      tenantRows,
      contractRows: linkage.rows,
    };
  }

  /**
   * Commits a validated PDF batch in two phases:
   *
   * Phase 1 (one shared transaction): create every VALID building, then every VALID
   * property (resolving pending building refs from phase 1's own output), then every
   * VALID tenant — mirrors BuildingsImporter/PropertiesImporter/TenantsImporter's own
   * commitRows(), calling the exact same *Service.create() methods.
   *
   * Phase 2 (one transaction per contract, run only after phase 1 has fully committed):
   * create each VALID contract via ContractsService.create(). This can't be folded into
   * phase 1's transaction — ContractsService.create() checks tenant/property existence
   * via TenantsService.ensureTenantExists()/PropertiesService.findOne(), and neither
   * accepts a transaction client, so they query through a separate DB connection that
   * can't see phase 1's writes until they've actually committed. Splitting into two
   * phases sidesteps that without touching those pre-existing methods. One contract
   * row failing doesn't undo phase 1 or any other contract — consistent with the
   * graceful-degradation approach the extraction step already uses (§10).
   */
  async commit(contractSessionId: string, userId: string): Promise<PdfBatchCommitResult> {
    const contractSession = await this.prisma.importSession.findUnique({ where: { id: contractSessionId } });
    if (!contractSession || contractSession.module !== ImportModule.CONTRACTS) {
      throw new NotFoundException('PDF import session not found');
    }
    if (contractSession.status === ImportStatus.COMMITTED) {
      throw new ConflictException('This PDF batch has already been committed');
    }

    const linkage = contractSession.rowsData as unknown as PdfBatchLinkage;
    if (!linkage || linkage.kind !== 'pdf-batch') {
      throw new BadRequestException('Session is not a PDF import batch');
    }

    const { buildingRows, propertyRows, tenantRows } = await this.loadLeafRows(linkage);
    const validContractRows = linkage.rows.filter((r) => r.status === 'VALID');

    if (validContractRows.length === 0) {
      throw new BadRequestException('This PDF batch has no valid contract rows to commit');
    }

    const buildingIdByIndex = new Map<number, string>();
    const propertyIdByIndex = new Map<number, string>();
    const tenantIdByIndex = new Map<number, string>();

    try {
      await this.prisma.$transaction(async (tx) => {
        const client = tx as Prisma.TransactionClient;

        for (let i = 0; i < buildingRows.length; i++) {
          const row = buildingRows[i];
          if (row.status !== 'VALID') continue;
          try {
            const created = await this.buildingsService.create(
              row.data as unknown as CreateBuildingDto,
              userId,
              client,
            );
            buildingIdByIndex.set(i, created.id);
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[building] ${(error as Error).message}`);
          }
        }

        for (let i = 0; i < propertyRows.length; i++) {
          const row = propertyRows[i];
          if (row.status !== 'VALID') continue;

          let buildingId: string;
          try {
            buildingId = resolvePendingRef(
              row.resolvedRefs?.buildingId ?? String(row.data.buildingId ?? ''),
              buildingIdByIndex,
              'building',
            );
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[property] ${(error as Error).message}`);
          }

          try {
            const created = await this.propertiesService.create(
              { ...(row.data as Record<string, unknown>), buildingId } as unknown as CreatePropertyDto,
              userId,
              client,
            );
            propertyIdByIndex.set(i, created.id);
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[property] ${(error as Error).message}`);
          }
        }

        for (let i = 0; i < tenantRows.length; i++) {
          const row = tenantRows[i];
          if (row.status !== 'VALID') continue;
          try {
            const created = await this.tenantsService.create(
              row.data as unknown as CreateTenantDto,
              userId,
              client,
              IMPORT_OPTIONAL_COMPANY_FIELDS,
            );
            tenantIdByIndex.set(i, created.id);
          } catch (error) {
            throw new ImportCommitRowError(row.rowNumber, `[tenant] ${(error as Error).message}`);
          }
        }
      });
    } catch (error) {
      await this.prisma.importSession.update({
        where: { id: contractSessionId },
        data: { status: ImportStatus.FAILED },
      });

      if (error instanceof ImportCommitRowError) {
        throw new ConflictException(
          `Commit failed at row ${error.rowNumber}: ${error.reason}. No buildings/properties/tenants were ` +
            'created (transaction rolled back); contracts were not attempted.',
        );
      }
      throw error;
    }

    const contractFailures: PdfCommitContractFailure[] = [];
    const contractIds: string[] = [];

    for (const row of validContractRows) {
      let tenantId: string;
      let propertyId: string;
      try {
        tenantId = resolvePendingRef(row.resolvedRefs?.tenantId ?? '', tenantIdByIndex, 'tenant');
        propertyId = resolvePendingRef(row.resolvedRefs?.propertyId ?? '', propertyIdByIndex, 'property');
      } catch (error) {
        contractFailures.push({ rowNumber: row.rowNumber, reason: (error as Error).message });
        continue;
      }

      const dto = { ...(row.data as Record<string, unknown>), tenantId, propertyId } as unknown as CreateContractDto;

      try {
        const created = await this.contractsService.create(dto, userId);
        contractIds.push(created.id);

        const sourceFile = linkage.sourceFiles?.[row.rowNumber];
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
            this.logger.warn(
              `Contract ${created.id} committed but its source PDF could not be attached: ${(error as Error).message}`,
            );
          }
        }
      } catch (error) {
        contractFailures.push({ rowNumber: row.rowNumber, reason: (error as Error).message });
      }
    }

    const allContractsCommitted = contractFailures.length === 0;
    await this.prisma.importSession.update({
      where: { id: contractSessionId },
      data: {
        status: allContractsCommitted ? ImportStatus.COMMITTED : ImportStatus.FAILED,
        ...(allContractsCommitted ? { committedAt: new Date() } : {}),
      },
    });
    await Promise.all(
      [linkage.buildingsSessionId, linkage.propertiesSessionId, linkage.tenantsSessionId]
        .filter((id): id is string => Boolean(id))
        .map((id) =>
          this.prisma.importSession.update({
            where: { id },
            data: { status: ImportStatus.COMMITTED, committedAt: new Date() },
          }),
        ),
    );

    this.logger.log('PDF batch committed', {
      contractSessionId,
      buildingsCreated: buildingIdByIndex.size,
      propertiesCreated: propertyIdByIndex.size,
      tenantsCreated: tenantIdByIndex.size,
      contractsCreated: contractIds.length,
      contractFailures: contractFailures.length,
      userId,
      action: 'COMMIT_PDF_BATCH',
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

  private async loadLeafRows(
    linkage: PdfBatchLinkage,
  ): Promise<{ buildingRows: RowResult[]; propertyRows: RowResult[]; tenantRows: RowResult[] }> {
    const [buildingsSession, propertiesSession, tenantsSession] = await Promise.all([
      linkage.buildingsSessionId
        ? this.prisma.importSession.findUnique({ where: { id: linkage.buildingsSessionId } })
        : null,
      linkage.propertiesSessionId
        ? this.prisma.importSession.findUnique({ where: { id: linkage.propertiesSessionId } })
        : null,
      linkage.tenantsSessionId
        ? this.prisma.importSession.findUnique({ where: { id: linkage.tenantsSessionId } })
        : null,
    ]);

    return {
      buildingRows: (buildingsSession?.rowsData as unknown as RowResult[]) ?? [],
      propertyRows: (propertiesSession?.rowsData as unknown as RowResult[]) ?? [],
      tenantRows: (tenantsSession?.rowsData as unknown as RowResult[]) ?? [],
    };
  }

  private async createLeafSession(
    module: ImportModule,
    rows: RowResult[],
    userId: string,
  ): Promise<string | null> {
    if (rows.length === 0) return null;

    const validRows = rows.filter((r) => r.status === 'VALID').length;
    const session = await this.prisma.importSession.create({
      data: {
        module,
        originalName: 'DMT PDF ingestion (candidate rows)',
        totalRows: rows.length,
        validRows,
        errorRows: rows.length - validRows,
        rowsData: rows as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return session.id;
  }

  private assertBatchLimits(files: Express.Multer.File[]): void {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one PDF file is required');
    }
    if (files.length > MAX_PDF_FILES_PER_BATCH) {
      throw new BadRequestException(`A batch may contain at most ${MAX_PDF_FILES_PER_BATCH} PDFs`);
    }
    for (const file of files) {
      if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
        throw new BadRequestException(
          `${file.originalname} exceeds the ${MAX_PDF_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit`,
        );
      }
      const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        throw new BadRequestException(`${file.originalname} is not a PDF`);
      }
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** A resolvedRefs token is either an already-real id (looked up in the DB at
 * preview time) or `pending:<kind>:<index>` (a candidate created earlier in this
 * same commit). Resolves the latter against the id map built as phase 1 runs. */
function resolvePendingRef(
  token: string,
  createdIdByIndex: Map<number, string>,
  kind: 'building' | 'property' | 'tenant',
): string {
  if (!token) {
    throw new Error(`Missing ${kind} reference`);
  }
  const match = token.match(/^pending:(?:building|property|tenant):(\d+)$/);
  if (!match) {
    return token;
  }
  const index = Number(match[1]);
  const resolved = createdIdByIndex.get(index);
  if (!resolved) {
    throw new Error(
      `Referenced ${kind} candidate row #${index} was not created (invalid or skipped) — cannot commit this row`,
    );
  }
  return resolved;
}

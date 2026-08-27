import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { ImportStatus } from '../../../../common/enums/import-status.enum';
import { ImportSessionType } from '../../../../common/enums/import-session-type.enum';
import { RowResult } from '../row-result';
import { ImportCommitRowError } from '../import-commit-row.error';
import { FileParserService } from './file-parser.service';
import { ModuleImporter } from './importers/importer.interface';
import { BuildingsImporter } from './importers/buildings.importer';
import { PropertiesImporter } from './importers/properties.importer';
import { TenantsImporter } from './importers/tenants.importer';
import { ContractsImporter } from './importers/contracts.importer';

/** This service only ever handles the CSV/XLSX path, so the session type follows
 * directly from the module being imported. */
const CSV_SESSION_TYPE_BY_MODULE: Record<ImportModule, ImportSessionType> = {
  [ImportModule.BUILDINGS]: ImportSessionType.CSV_EXCEL_BUILDINGS,
  [ImportModule.PROPERTIES]: ImportSessionType.CSV_EXCEL_PROPERTIES,
  [ImportModule.TENANTS]: ImportSessionType.CSV_EXCEL_TENANTS,
  [ImportModule.CONTRACTS]: ImportSessionType.CSV_EXCEL_CONTRACTS,
};

@Injectable()
export class ImportSessionService {
  private readonly logger = new Logger(ImportSessionService.name);
  private readonly importers: Map<ImportModule, ModuleImporter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileParser: FileParserService,
    buildingsImporter: BuildingsImporter,
    propertiesImporter: PropertiesImporter,
    tenantsImporter: TenantsImporter,
    contractsImporter: ContractsImporter,
  ) {
    this.importers = new Map<ImportModule, ModuleImporter>([
      [buildingsImporter.module, buildingsImporter],
      [propertiesImporter.module, propertiesImporter],
      [tenantsImporter.module, tenantsImporter],
      [contractsImporter.module, contractsImporter],
    ]);
  }

  async validate(module: ImportModule, file: Express.Multer.File, userId: string) {
    const importer = this.getImporter(module);
    const parsed = await this.fileParser.parseFile(file);
    const rows = await importer.validateRows(parsed.rows);

    const validRows = rows.filter((r) => r.status === 'VALID').length;
    const errorRows = rows.length - validRows;

    const session = await this.prisma.importSession.create({
      data: {
        module,
        sessionType: CSV_SESSION_TYPE_BY_MODULE[module],
        originalName: file.originalname,
        totalRows: rows.length,
        validRows,
        errorRows,
        rowsData: rows as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    this.logger.log('Import validated', {
      sessionId: session.id,
      module,
      totalRows: rows.length,
      validRows,
      errorRows,
      userId,
      action: 'VALIDATE_IMPORT',
    });

    return { ...session, rows };
  }

  async findOne(id: string) {
    const session = await this.prisma.importSession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('Import session not found');
    }
    return { ...session, rows: session.rowsData as unknown as RowResult[] };
  }

  async commit(sessionId: string, moduleFromPath: ImportModule, userId: string) {
    const session = await this.prisma.importSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Import session not found');
    }

    if (session.module !== moduleFromPath) {
      throw new BadRequestException(
        `Session ${sessionId} belongs to module ${session.module}, not ${moduleFromPath}`,
      );
    }

    if (session.status === ImportStatus.COMMITTED) {
      throw new ConflictException('Import session has already been committed');
    }

    const rows = session.rowsData as unknown as RowResult[];
    const validRows = rows.filter((r) => r.status === 'VALID');

    if (validRows.length === 0) {
      throw new BadRequestException('Import session has no valid rows to commit');
    }

    const importer = this.getImporter(moduleFromPath);

    try {
      const inserted = await importer.commitRows(validRows, userId);

      await this.prisma.importSession.update({
        where: { id: sessionId },
        data: { status: ImportStatus.COMMITTED, committedAt: new Date() },
      });

      this.logger.log('Import committed', {
        sessionId,
        module: moduleFromPath,
        inserted,
        userId,
        action: 'COMMIT_IMPORT',
      });

      return { inserted, module: moduleFromPath };
    } catch (error) {
      await this.prisma.importSession.update({
        where: { id: sessionId },
        data: { status: ImportStatus.FAILED },
      });

      if (error instanceof ImportCommitRowError) {
        this.logger.warn('Import commit failed at a specific row', {
          sessionId,
          module: moduleFromPath,
          rowNumber: error.rowNumber,
          userId,
          action: 'COMMIT_IMPORT_FAILED',
        });
        throw new ConflictException(
          `Commit failed at row ${error.rowNumber}: ${error.reason}. No rows were inserted (transaction rolled back).`,
        );
      }

      this.logger.warn('Import commit failed', {
        sessionId,
        module: moduleFromPath,
        userId,
        error: (error as Error).message,
        action: 'COMMIT_IMPORT_FAILED',
      });
      throw error;
    }
  }

  private getImporter(module: ImportModule): ModuleImporter {
    const importer = this.importers.get(module);
    if (!importer) {
      throw new BadRequestException(`Import is not yet supported for module ${module}`);
    }
    return importer;
  }
}

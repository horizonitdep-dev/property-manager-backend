import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ImportSessionService } from './import-session.service';
import { PrismaService } from '../../../../database/prisma.service';
import { FileParserService } from './file-parser.service';
import { BuildingsImporter } from './importers/buildings.importer';
import { PropertiesImporter } from './importers/properties.importer';
import { TenantsImporter } from './importers/tenants.importer';
import { ContractsImporter } from './importers/contracts.importer';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { ImportStatus } from '../../../../common/enums/import-status.enum';
import { ImportCommitRowError } from '../import-commit-row.error';

describe('ImportSessionService', () => {
  let service: ImportSessionService;
  let prisma: { importSession: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };
  let fileParser: { parseFile: jest.Mock };
  let buildingsImporter: { module: ImportModule; validateRows: jest.Mock; commitRows: jest.Mock };

  beforeEach(async () => {
    prisma = {
      importSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    fileParser = { parseFile: jest.fn() };
    buildingsImporter = {
      module: ImportModule.BUILDINGS,
      validateRows: jest.fn(),
      commitRows: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportSessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FileParserService, useValue: fileParser },
        { provide: BuildingsImporter, useValue: buildingsImporter },
        { provide: PropertiesImporter, useValue: { module: ImportModule.PROPERTIES } },
        { provide: TenantsImporter, useValue: { module: ImportModule.TENANTS } },
        { provide: ContractsImporter, useValue: { module: ImportModule.CONTRACTS } },
      ],
    }).compile();

    service = module.get(ImportSessionService);
  });

  describe('validate', () => {
    it('never writes business data — only creates the session record', async () => {
      fileParser.parseFile.mockResolvedValue({ rows: [{ rowNumber: 2, rawValues: {} }] });
      buildingsImporter.validateRows.mockResolvedValue([
        { rowNumber: 2, data: {}, status: 'VALID', errors: [] },
      ]);
      prisma.importSession.create.mockResolvedValue({
        id: 'session-1',
        status: ImportStatus.PENDING_REVIEW,
      });

      await service.validate(ImportModule.BUILDINGS, {} as Express.Multer.File, 'user-1');

      expect(prisma.importSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ module: ImportModule.BUILDINGS, validRows: 1, errorRows: 0 }),
        }),
      );
    });
  });

  describe('commit', () => {
    const baseSession = {
      id: 'session-1',
      module: ImportModule.BUILDINGS,
      status: ImportStatus.PENDING_REVIEW,
      rowsData: [{ rowNumber: 2, data: {}, status: 'VALID', errors: [] }],
    };

    it('rejects when the path module does not match the session module', async () => {
      prisma.importSession.findUnique.mockResolvedValue(baseSession);

      await expect(service.commit('session-1', ImportModule.PROPERTIES, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects re-committing an already-COMMITTED session with 409', async () => {
      prisma.importSession.findUnique.mockResolvedValue({
        ...baseSession,
        status: ImportStatus.COMMITTED,
      });

      await expect(service.commit('session-1', ImportModule.BUILDINGS, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a session with zero valid rows', async () => {
      prisma.importSession.findUnique.mockResolvedValue({
        ...baseSession,
        rowsData: [{ rowNumber: 2, data: {}, status: 'ERROR', errors: [] }],
      });

      await expect(service.commit('session-1', ImportModule.BUILDINGS, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s for a nonexistent session', async () => {
      prisma.importSession.findUnique.mockResolvedValue(null);

      await expect(service.commit('nonexistent', ImportModule.BUILDINGS, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks the session COMMITTED and returns the inserted count on success', async () => {
      prisma.importSession.findUnique.mockResolvedValue(baseSession);
      buildingsImporter.commitRows.mockResolvedValue(1);

      const result = await service.commit('session-1', ImportModule.BUILDINGS, 'user-1');

      expect(result).toEqual({ inserted: 1, module: ImportModule.BUILDINGS });
      expect(prisma.importSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportStatus.COMMITTED }),
        }),
      );
    });

    it('marks the session FAILED and surfaces the failing row when commitRows throws', async () => {
      prisma.importSession.findUnique.mockResolvedValue(baseSession);
      buildingsImporter.commitRows.mockRejectedValue(
        new ImportCommitRowError(5, 'Building code already exists'),
      );

      await expect(service.commit('session-1', ImportModule.BUILDINGS, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.commit('session-1', ImportModule.BUILDINGS, 'user-1')).rejects.toThrow(/row 5/);
      expect(prisma.importSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportStatus.FAILED }),
        }),
      );
    });
  });
});

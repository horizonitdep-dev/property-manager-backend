import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { StorageService } from '../../../../shared/storage/storage.service';
import { BuildingsService } from '../../buildings/buildings.service';
import { PropertiesService } from '../../properties/properties.service';
import { TenantsService } from '../../tenants/tenants.service';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractSource } from '../../../../common/enums/contract-source.enum';
import { ImportSessionType } from '../../../../common/enums/import-session-type.enum';
import { ImportStatus } from '../../../../common/enums/import-status.enum';
import { GreenContractExtractionService } from './green-contract-extraction.service';
import { GreenContractResolutionService } from './green-contract-resolution.service';
import { GreenContractImportService } from './green-contract-import.service';
import { GreenContractExtractionError } from '../green-contract-extraction.error';

const SESSION_ID = '55555555-5555-4555-8555-555555555555';

function pdf(name = 'green.pdf'): Express.Multer.File {
  return {
    originalname: name,
    buffer: Buffer.from('%PDF-1.6'),
    size: 1024,
    mimetype: 'application/pdf',
  } as Express.Multer.File;
}

function extractionResult() {
  return {
    sourceFileName: 'green.pdf',
    building: { code: 'R6', name: 'R6', flags: [] },
    unit: { unitNumber: '101', flags: [] },
    tenant: { tenantType: 'Individual' as const, nameEn: 'Test Tenant', flags: [] },
    contract: {
      contractNumber: 'GC-R6-101',
      startDate: '2026-07-08',
      endDate: '2027-07-07',
      annualRent: 47250,
      monthlyRent: 3938,
      paymentFrequency: 'Cheques',
      numberOfCheques: 4,
      flags: [],
    },
    usage: { inputTokens: 2260, outputTokens: 282 },
    rawExtraction: { building: { code: 'R6' } },
  };
}

/** A committable batch payload as stored on the session. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'green-contract-batch',
    failures: [],
    buildingRows: [],
    propertyRows: [],
    tenantRows: [],
    contractRows: [
      {
        rowNumber: 1,
        status: 'VALID',
        errors: [],
        data: { contractNumber: 'GC-R6-101' },
        resolvedRefs: { tenantId: 'tenant-id', propertyId: 'property-id' },
      },
    ],
    sourceFiles: {},
    rawExtractions: {},
    ...overrides,
  };
}

describe('GreenContractImportService', () => {
  let service: GreenContractImportService;
  let prisma: {
    importSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    contractDocument: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let extraction: { extract: jest.Mock };
  let resolution: { resolveBatch: jest.Mock };
  let contracts: { create: jest.Mock };
  let storage: { uploadFile: jest.Mock };

  beforeEach(async () => {
    prisma = {
      importSession: {
        create: jest.fn().mockResolvedValue({ id: SESSION_ID }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      contractDocument: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    extraction = { extract: jest.fn().mockResolvedValue(extractionResult()) };
    resolution = {
      resolveBatch: jest.fn().mockResolvedValue({
        buildings: { rows: [], keys: [] },
        properties: { rows: [], keys: [] },
        tenants: { rows: [], keys: [] },
        contracts: [{ rowNumber: 1, status: 'VALID', errors: [], data: {}, resolvedRefs: {} }],
      }),
    };
    contracts = { create: jest.fn().mockResolvedValue({ id: 'new-contract-id' }) };
    storage = { uploadFile: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GreenContractImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: GreenContractExtractionService, useValue: extraction },
        { provide: GreenContractResolutionService, useValue: resolution },
        { provide: BuildingsService, useValue: { create: jest.fn() } },
        { provide: PropertiesService, useValue: { create: jest.fn() } },
        { provide: TenantsService, useValue: { create: jest.fn() } },
        { provide: ContractsService, useValue: contracts },
      ],
    }).compile();

    service = module.get(GreenContractImportService);
  });

  describe('validate', () => {
    it('stores the session tagged R6_GREEN_CONTRACT', async () => {
      await service.validate([pdf()], 'user-1');

      expect(prisma.importSession.create.mock.calls[0][0].data.sessionType).toBe(
        ImportSessionType.R6_GREEN_CONTRACT,
      );
    });

    it('writes no business data', async () => {
      await service.validate([pdf()], 'user-1');

      expect(contracts.create).not.toHaveBeenCalled();
    });

    it('keeps going when one PDF fails to extract', async () => {
      extraction.extract
        .mockRejectedValueOnce(new GreenContractExtractionError('bad.pdf', 'Model returned malformed JSON'))
        .mockResolvedValueOnce(extractionResult());

      const preview = await service.validate([pdf('bad.pdf'), pdf('good.pdf')], 'user-1');

      expect(preview.failures).toEqual([
        { fileName: 'bad.pdf', reason: 'Model returned malformed JSON' },
      ]);
      expect(preview.summary.pdfsExtracted).toBe(1);
      expect(preview.summary.pdfsFailed).toBe(1);
    });

    it('stages each PDF so commit can attach it later', async () => {
      await service.validate([pdf()], 'user-1');

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^green-contracts\/staging\//),
        expect.any(Buffer),
        'application/pdf',
      );
    });

    it('still previews when staging fails — the row just loses its attachment', async () => {
      storage.uploadFile.mockRejectedValue(new Error('bucket unreachable'));

      await expect(service.validate([pdf()], 'user-1')).resolves.toBeDefined();
    });

    it('counts blocked rows separately from extracted ones', async () => {
      resolution.resolveBatch.mockResolvedValue({
        buildings: { rows: [], keys: [] },
        properties: { rows: [], keys: [] },
        tenants: { rows: [], keys: [] },
        contracts: [
          { rowNumber: 1, status: 'VALID', errors: [], data: {}, resolvedRefs: {} },
          { rowNumber: 2, status: 'ERROR', errors: [{ field: 'propertyId', message: 'blocked' }], data: {} },
        ],
      });

      const preview = await service.validate([pdf(), pdf()], 'user-1');

      expect(preview.summary.candidateContracts).toBe(2);
      expect(preview.summary.blockedContracts).toBe(1);
    });

    describe('guardrails', () => {
      it.each([
        [[], 'At least one PDF is required'],
        [Array.from({ length: 11 }, () => pdf()), 'limited to 10 PDFs'],
      ])('rejects a bad batch size', async (files, message) => {
        await expect(service.validate(files as Express.Multer.File[], 'user-1')).rejects.toThrow(message);
      });

      it('rejects a non-PDF', async () => {
        const notPdf = { ...pdf('notes.txt'), mimetype: 'text/plain' } as Express.Multer.File;

        await expect(service.validate([notPdf], 'user-1')).rejects.toThrow('notes.txt is not a PDF');
      });

      it('rejects a file over 10 MB', async () => {
        const big = { ...pdf('big.pdf'), size: 11 * 1024 * 1024 } as Express.Multer.File;

        await expect(service.validate([big], 'user-1')).rejects.toThrow(/10 MB/);
      });
    });
  });

  describe('session isolation (§9)', () => {
    it('refuses a DMT session', async () => {
      prisma.importSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        sessionType: ImportSessionType.DMT_TAWTHEEQ,
        rowsData: { kind: 'pdf-batch' },
      });

      await expect(service.commit(SESSION_ID, 'user-1')).rejects.toThrow(
        /belongs to the DMT_TAWTHEEQ importer/,
      );
    });

    it('refuses a CSV session', async () => {
      prisma.importSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        sessionType: ImportSessionType.CSV_EXCEL_CONTRACTS,
        rowsData: [],
      });

      await expect(service.findOne(SESSION_ID)).rejects.toThrow(BadRequestException);
    });

    it('404s for an unknown session', async () => {
      prisma.importSession.findUnique.mockResolvedValue(null);

      await expect(service.commit(SESSION_ID, 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('commit', () => {
    function sessionWith(overrides: Record<string, unknown> = {}) {
      prisma.importSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        sessionType: ImportSessionType.R6_GREEN_CONTRACT,
        status: ImportStatus.PENDING_REVIEW,
        rowsData: payload(),
        ...overrides,
      });
    }

    it('stamps every created contract with R6_GREEN_CONTRACT', async () => {
      sessionWith();

      await service.commit(SESSION_ID, 'user-1');

      expect(contracts.create).toHaveBeenCalledWith(
        expect.any(Object),
        'user-1',
        undefined,
        ContractSource.R6_GREEN_CONTRACT,
      );
    });

    it('attaches the source PDF to the contract it created', async () => {
      sessionWith({
        rowsData: payload({
          sourceFiles: {
            1: { fileKey: 'k', fileName: 'green.pdf', fileSize: 10, mimeType: 'application/pdf' },
          },
        }),
      });

      await service.commit(SESSION_ID, 'user-1');

      expect(prisma.contractDocument.create.mock.calls[0][0].data).toMatchObject({
        contractId: 'new-contract-id',
        fileName: 'green.pdf',
      });
    });

    it('keeps the contract when attaching its PDF fails', async () => {
      sessionWith({
        rowsData: payload({
          sourceFiles: {
            1: { fileKey: 'k', fileName: 'green.pdf', fileSize: 10, mimeType: 'application/pdf' },
          },
        }),
      });
      prisma.contractDocument.create.mockRejectedValue(new Error('storage row failed'));

      const result = await service.commit(SESSION_ID, 'user-1');

      expect(result.contractsCreated).toBe(1);
      expect(result.contractFailures).toHaveLength(0);
    });

    it('marks the session COMMITTED', async () => {
      sessionWith();

      await service.commit(SESSION_ID, 'user-1');

      const update = prisma.importSession.update.mock.calls.at(-1)![0];
      expect(update.data.status).toBe(ImportStatus.COMMITTED);
      expect(update.data.committedAt).toBeInstanceOf(Date);
    });

    it('refuses to commit the same batch twice', async () => {
      sessionWith({ status: ImportStatus.COMMITTED });

      await expect(service.commit(SESSION_ID, 'user-1')).rejects.toThrow(ConflictException);
    });

    it('refuses a batch where every row was blocked', async () => {
      sessionWith({
        rowsData: payload({
          contractRows: [{ rowNumber: 1, status: 'ERROR', errors: [{ field: 'x', message: 'blocked' }], data: {} }],
        }),
      });

      await expect(service.commit(SESSION_ID, 'user-1')).rejects.toThrow(/no committable rows/);
    });

    it('records a per-row failure without sinking the rest', async () => {
      sessionWith({
        rowsData: payload({
          contractRows: [
            { rowNumber: 1, status: 'VALID', errors: [], data: {}, resolvedRefs: { tenantId: 't', propertyId: 'p' } },
            { rowNumber: 2, status: 'VALID', errors: [], data: {}, resolvedRefs: { tenantId: 't', propertyId: 'p' } },
          ],
        }),
      });
      contracts.create
        .mockResolvedValueOnce({ id: 'contract-1' })
        .mockRejectedValueOnce(new Error('overlapping dates'));

      const result = await service.commit(SESSION_ID, 'user-1');

      expect(result.contractsCreated).toBe(1);
      expect(result.contractFailures).toEqual([{ rowNumber: 2, reason: 'overlapping dates' }]);
    });
  });
});

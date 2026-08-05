import { Test, TestingModule } from '@nestjs/testing';
import { BuildingsImporter } from './buildings.importer';
import { PrismaService } from '../../../../../database/prisma.service';
import { BuildingsService } from '../../../buildings/buildings.service';
import { ParsedRow } from '../file-parser.service';
import { ImportCommitRowError } from '../../import-commit-row.error';

function row(rowNumber: number, values: Record<string, string | null>): ParsedRow {
  return { rowNumber, rawValues: values };
}

function validRowValues(): Record<string, string | null> {
  return {
    'building name': 'Al Noor Tower',
    'building code': 'R6',
    address: '1 Test St',
    city: 'Abu Dhabi',
    'building type': 'Residential',
    'total floors': '4',
    'total units': '35',
    'construction status': 'Complete',
    notes: 'x',
  };
}

describe('BuildingsImporter', () => {
  let importer: BuildingsImporter;
  let prisma: { building: { findFirst: jest.Mock }; $transaction: jest.Mock };
  let buildingsService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = {
      building: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    buildingsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingsImporter,
        { provide: PrismaService, useValue: prisma },
        { provide: BuildingsService, useValue: buildingsService },
      ],
    }).compile();

    importer = module.get(BuildingsImporter);
  });

  describe('validateRows', () => {
    it('marks a fully valid row VALID with no errors', async () => {
      prisma.building.findFirst.mockResolvedValue(null);

      const [result] = await importer.validateRows([row(2, validRowValues())]);

      expect(result.status).toBe('VALID');
      expect(result.errors).toEqual([]);
    });

    it('flags a missing required cell on the correct row', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      const values = validRowValues();
      values['building name'] = null;

      const [result] = await importer.validateRows([row(7, values)]);

      expect(result.status).toBe('ERROR');
      expect(result.rowNumber).toBe(7);
      expect(result.errors.some((e) => e.field === 'name')).toBe(true);
    });

    it('rejects an unrecognized enum label and lists the allowed values', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      const values = validRowValues();
      values['building type'] = 'Bungalow';

      const [result] = await importer.validateRows([row(2, values)]);

      const error = result.errors.find((e) => e.field === 'Building Type');
      expect(error?.message).toContain('Bungalow');
      expect(error?.message).toContain('residential');
    });

    it('accepts a recognized enum label case-insensitively', async () => {
      prisma.building.findFirst.mockResolvedValue(null);
      const values = validRowValues();
      values['building type'] = 'RESIDENTIAL';

      const [result] = await importer.validateRows([row(2, values)]);

      expect(result.status).toBe('VALID');
    });

    it('flags an in-file duplicate code on the later row, keeping the first VALID', async () => {
      prisma.building.findFirst.mockResolvedValue(null);

      const results = await importer.validateRows([row(2, validRowValues()), row(3, validRowValues())]);

      expect(results[0].status).toBe('VALID');
      expect(results[1].status).toBe('ERROR');
      expect(results[1].errors[0].message).toContain("already used in row 2");
    });

    it('flags an against-DB duplicate code', async () => {
      prisma.building.findFirst.mockResolvedValue({ id: 'existing-building' });

      const [result] = await importer.validateRows([row(2, validRowValues())]);

      expect(result.status).toBe('ERROR');
      expect(result.errors.some((e) => e.message.includes('already exists'))).toBe(true);
    });
  });

  describe('commitRows', () => {
    it('inserts only valid rows via the real BuildingsService.create path, inside the transaction', async () => {
      buildingsService.create.mockResolvedValue({ id: 'new-id' });

      const inserted = await importer.commitRows(
        [{ rowNumber: 2, data: { code: 'R6' }, status: 'VALID', errors: [] }],
        'user-1',
      );

      expect(inserted).toBe(1);
      expect(buildingsService.create).toHaveBeenCalledWith({ code: 'R6' }, 'user-1', prisma);
    });

    it('wraps a commit-time failure with the offending row number', async () => {
      buildingsService.create.mockRejectedValue(new Error('Building code already exists'));

      await expect(
        importer.commitRows([{ rowNumber: 5, data: { code: 'R6' }, status: 'VALID', errors: [] }], 'user-1'),
      ).rejects.toBeInstanceOf(ImportCommitRowError);
      await expect(
        importer.commitRows([{ rowNumber: 5, data: { code: 'R6' }, status: 'VALID', errors: [] }], 'user-1'),
      ).rejects.toMatchObject({ rowNumber: 5 });
    });
  });
});

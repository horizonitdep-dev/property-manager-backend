import { Test, TestingModule } from '@nestjs/testing';
import { PropertiesImporter } from './properties.importer';
import { PrismaService } from '../../../../../database/prisma.service';
import { PropertiesService } from '../../../properties/properties.service';
import { ParsedRow } from '../file-parser.service';

function row(rowNumber: number, values: Record<string, string | null>): ParsedRow {
  return { rowNumber, rawValues: values };
}

function validRowValues(): Record<string, string | null> {
  return {
    'building code': 'R6',
    'unit number': '101',
    floor: '1',
    'unit type': 'Apartment',
    bedrooms: '2',
    bathrooms: '1',
    'size (sqm)': '85.5',
    'monthly rent': '2500',
    status: 'Vacant',
    notes: null,
  };
}

describe('PropertiesImporter', () => {
  let importer: PropertiesImporter;
  let prisma: {
    building: { findFirst: jest.Mock };
    property: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let propertiesService: { create: jest.Mock };

  const existingBuilding = { id: '11111111-1111-4111-8111-111111111111', code: 'R6', deletedAt: null };

  beforeEach(async () => {
    prisma = {
      building: { findFirst: jest.fn() },
      property: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    propertiesService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertiesImporter,
        { provide: PrismaService, useValue: prisma },
        { provide: PropertiesService, useValue: propertiesService },
      ],
    }).compile();

    importer = module.get(PropertiesImporter);
  });

  describe('validateRows', () => {
    it('resolves the building code to a buildingId and marks the row VALID', async () => {
      prisma.building.findFirst.mockResolvedValue(existingBuilding);
      prisma.property.findFirst.mockResolvedValue(null);

      const [result] = await importer.validateRows([row(2, validRowValues())]);

      expect(result.status).toBe('VALID');
      expect(result.resolvedRefs).toEqual({ buildingId: existingBuilding.id });
      expect((result.data as { buildingId: string }).buildingId).toBe(existingBuilding.id);
    });

    it('flags an unresolvable building code', async () => {
      prisma.building.findFirst.mockResolvedValue(null);

      const [result] = await importer.validateRows([row(2, validRowValues())]);

      expect(result.status).toBe('ERROR');
      expect(result.errors.some((e) => e.message.includes("Building not found: 'R6'"))).toBe(true);
    });

    it('rejects an unrecognized Unit Type label', async () => {
      prisma.building.findFirst.mockResolvedValue(existingBuilding);
      prisma.property.findFirst.mockResolvedValue(null);
      const values = validRowValues();
      values['unit type'] = 'Bungalow';

      const [result] = await importer.validateRows([row(2, values)]);

      expect(result.errors.some((e) => e.field === 'Unit Type')).toBe(true);
    });

    it('flags an in-file duplicate unit number within the same building', async () => {
      prisma.building.findFirst.mockResolvedValue(existingBuilding);
      prisma.property.findFirst.mockResolvedValue(null);

      const results = await importer.validateRows([
        row(2, validRowValues()),
        row(3, validRowValues()),
      ]);

      expect(results[0].status).toBe('VALID');
      expect(results[1].status).toBe('ERROR');
      expect(results[1].errors[0].message).toContain('already used in row 2');
    });

    it('flags an against-DB duplicate unit number in the same building', async () => {
      prisma.building.findFirst.mockResolvedValue(existingBuilding);
      prisma.property.findFirst.mockResolvedValue({ id: 'existing-property' });

      const [result] = await importer.validateRows([row(2, validRowValues())]);

      expect(result.status).toBe('ERROR');
      expect(result.errors.some((e) => e.message.includes('already exists in building'))).toBe(true);
    });
  });

  describe('commitRows', () => {
    it('inserts only valid rows via the real PropertiesService.create path', async () => {
      propertiesService.create.mockResolvedValue({ id: 'new-property' });

      const inserted = await importer.commitRows(
        [{ rowNumber: 2, data: { unitNumber: '101' }, status: 'VALID', errors: [] }],
        'user-1',
      );

      expect(inserted).toBe(1);
      expect(propertiesService.create).toHaveBeenCalledWith({ unitNumber: '101' }, 'user-1', prisma);
    });
  });
});

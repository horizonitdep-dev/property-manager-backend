import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { FileParserService, MAX_IMPORT_FILE_SIZE_BYTES, getCell } from './file-parser.service';

function csvFile(content: string, name = 'test.csv'): Express.Multer.File {
  const buffer = Buffer.from(content, 'utf8');
  return { buffer, originalname: name, mimetype: 'text/csv', size: buffer.length } as Express.Multer.File;
}

async function xlsxFile(rows: string[][], name = 'test.xlsx'): Promise<Express.Multer.File> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => worksheet.addRow(row));
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return {
    buffer,
    originalname: name,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
  } as Express.Multer.File;
}

describe('FileParserService', () => {
  let service: FileParserService;

  beforeEach(() => {
    service = new FileParserService();
  });

  it('parses CSV and XLSX to the same normalized rows', async () => {
    const csvResult = await service.parseFile(
      csvFile('Building Code,Building Name\nR6,Al Noor Tower\n'),
    );
    const xlsxResult = await service.parseFile(
      await xlsxFile([
        ['Building Code', 'Building Name'],
        ['R6', 'Al Noor Tower'],
      ]),
    );

    expect(csvResult.headers).toEqual(['building code', 'building name']);
    expect(xlsxResult.headers).toEqual(csvResult.headers);
    expect(csvResult.rows).toEqual(xlsxResult.rows);
    expect(getCell(csvResult.rows[0], 'Building Code')).toBe('R6');
  });

  it('round-trips Arabic text intact in both CSV and XLSX', async () => {
    const csvResult = await service.parseFile(
      csvFile('Name (Arabic)\nمبنى الاختبار\n'),
    );
    const xlsxResult = await service.parseFile(await xlsxFile([['Name (Arabic)'], ['مبنى الاختبار']]));

    expect(getCell(csvResult.rows[0], 'Name (Arabic)')).toBe('مبنى الاختبار');
    expect(getCell(xlsxResult.rows[0], 'Name (Arabic)')).toBe('مبنى الاختبار');
  });

  it('strips a UTF-8 BOM and normalizes header case/whitespace', async () => {
    const result = await service.parseFile(
      csvFile('﻿ Building  Code ,BUILDING NAME\nR6,Al Noor Tower\n'),
    );

    expect(result.headers).toEqual(['building code', 'building name']);
    expect(getCell(result.rows[0], '  building   CODE  ')).toBe('R6');
  });

  it('preserves the true spreadsheet row number across a blank row', async () => {
    const result = await service.parseFile(
      csvFile('Code\nA\n\nB\n'), // header=row1, A=row2, blank=row3, B=row4
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].rowNumber).toBe(4);
  });

  it('rejects a file over the size limit', async () => {
    const big = csvFile('a'.repeat(1));
    big.size = MAX_IMPORT_FILE_SIZE_BYTES + 1;

    await expect(service.parseFile(big)).rejects.toThrow(BadRequestException);
  });

  it('rejects a file with too many data rows', async () => {
    const header = 'Code\n';
    const rows = Array.from({ length: 5001 }, (_, i) => `R${i}`).join('\n');

    await expect(service.parseFile(csvFile(header + rows))).rejects.toThrow(BadRequestException);
  });

  it('rejects an unsupported file type', async () => {
    const file = csvFile('a,b\n1,2\n', 'test.txt');
    file.mimetype = 'text/plain';

    await expect(service.parseFile(file)).rejects.toThrow(BadRequestException);
  });
});

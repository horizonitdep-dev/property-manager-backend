import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { parse as parseCsvStream } from 'csv-parse';
import * as ExcelJS from 'exceljs';

export const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export interface ParsedRow {
  /** 1-based, matches the row number the user sees in their spreadsheet (accounts for the header row). */
  rowNumber: number;
  /** Keyed by normalizeHeader(header) — look up with getCell(row, 'Building Code'), never index directly. */
  rawValues: Record<string, string | null>;
}

export interface ParseResult {
  /** Normalized header names, in file order. */
  headers: string[];
  rows: ParsedRow[];
}

/** Case-insensitive, whitespace-tolerant header key: "  Building  Code " -> "building code". */
export function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Looks up a cell by its human-readable header name, applying the same normalization as parsing. */
export function getCell(row: ParsedRow, header: string): string | null {
  return row.rawValues[normalizeHeader(header)] ?? null;
}

type RawCell = string | number | boolean | Date | null;
type RawTable = RawCell[][];

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  async parseFile(file: Express.Multer.File): Promise<ParseResult> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit`,
      );
    }

    const extension = (file.originalname.split('.').pop() ?? '').toLowerCase();
    const isCsv = extension === 'csv' || file.mimetype === 'text/csv';
    const isXlsx =
      extension === 'xlsx' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    let table: RawTable;
    try {
      if (isCsv) {
        table = await this.parseCsvBuffer(file.buffer);
      } else if (isXlsx) {
        table = await this.parseXlsxBuffer(file.buffer);
      } else {
        throw new BadRequestException('Unsupported file type — upload a .csv or .xlsx file');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.warn(`Failed to parse import file: ${(error as Error).message}`);
      throw new BadRequestException('Could not parse file — check it is a valid CSV/XLSX export');
    }

    return this.buildParseResult(table);
  }

  private buildParseResult(table: RawTable): ParseResult {
    // Header must be the file's literal first row, and blank data rows are filtered out
    // AFTER rowNumber is assigned from each row's original position — never before —
    // so a blank line anywhere in the file can't desync every rowNumber after it.
    if (table.length === 0) {
      throw new BadRequestException('File has no header row');
    }

    const [headerRow, ...dataRows] = table;
    const headers = headerRow.map((cell) => normalizeHeader(this.cellToString(cell) ?? ''));

    if (headers.every((h) => !h)) {
      throw new BadRequestException('File has no header row');
    }

    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `File has ${dataRows.length} data rows; the limit is ${MAX_IMPORT_ROWS}`,
      );
    }

    const rows: ParsedRow[] = dataRows
      .map((cells, idx) => ({ cells, rowNumber: idx + 2 })) // +1 header row, +1 for 1-based
      .filter(({ cells }) => cells.some((c) => c !== null && c !== ''))
      .map(({ cells, rowNumber }) => {
        const rawValues: Record<string, string | null> = {};
        headers.forEach((header, colIndex) => {
          if (!header) return;
          rawValues[header] = this.cellToString(cells[colIndex]);
        });
        return { rowNumber, rawValues };
      });

    return { headers, rows };
  }

  private cellToString(cell: RawCell | undefined): string | null {
    if (cell === null || cell === undefined) return null;
    if (cell instanceof Date) return cell.toISOString().slice(0, 10);
    const str = typeof cell === 'string' ? cell : String(cell);
    const trimmed = str.trim();
    return trimmed === '' ? null : trimmed;
  }

  private parseCsvBuffer(buffer: Buffer): Promise<RawTable> {
    return new Promise((resolve, reject) => {
      const records: string[][] = [];
      const parser = parseCsvStream(buffer, {
        bom: true,
        encoding: 'utf8',
        // Blank lines are kept (not skipped) so positional row numbers stay intact;
        // buildParseResult() filters them out itself, after numbering.
        skip_empty_lines: false,
        relax_column_count: true,
        trim: false, // we trim ourselves after normalizing null/empty
      });

      parser.on('readable', () => {
        let record: string[] | null;
        // eslint-disable-next-line no-cond-assign
        while ((record = parser.read()) !== null) {
          records.push(record);
        }
      });
      parser.on('error', (err) => reject(err));
      parser.on('end', () => resolve(records));
    });
  }

  private async parseXlsxBuffer(buffer: Buffer): Promise<RawTable> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('Workbook has no worksheets');
    }

    const table: RawTable = [];
    // includeEmpty: true keeps blank rows in place so positional row numbers stay intact;
    // buildParseResult() filters them out itself, after numbering.
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as ExcelJS.CellValue[]; // 1-indexed; values[0] is unused
      const cells: RawCell[] = [];
      for (let i = 1; i < values.length; i++) {
        cells.push(this.excelCellToRaw(values[i]));
      }
      table.push(cells);
    });

    return table;
  }

  private excelCellToRaw(value: ExcelJS.CellValue): RawCell {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object') {
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText.map((part) => part.text).join('');
      }
      if ('text' in value && typeof value.text === 'string') {
        return value.text; // hyperlink cell
      }
      if ('result' in value) {
        return this.excelCellToRaw(value.result as ExcelJS.CellValue); // formula cell
      }
      return null;
    }
    return value as RawCell;
  }
}

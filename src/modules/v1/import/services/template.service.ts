import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import * as ExcelJS from 'exceljs';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { TEMPLATE_COLUMNS } from '../column-specs';
import { importModuleToSlug } from '../import-module-slug';

export interface GeneratedTemplate {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

@Injectable()
export class TemplateService {
  async generate(module: ImportModule, format: 'csv' | 'xlsx'): Promise<GeneratedTemplate> {
    const columns = TEMPLATE_COLUMNS[module];
    const slug = importModuleToSlug(module);

    if (format === 'csv') {
      return {
        buffer: this.buildCsv(columns),
        filename: `${slug}-template.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    return {
      buffer: await this.buildXlsx(columns),
      filename: `${slug}-template.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private buildCsv(columns: { header: string; example: string }[]): Buffer {
    const csv = stringify([columns.map((c) => c.header), columns.map((c) => c.example)]);
    // Prepend a UTF-8 BOM so Excel opens Arabic example values correctly.
    return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(csv, 'utf8')]);
  }

  private async buildXlsx(columns: { header: string; example: string }[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Template');
    worksheet.addRow(columns.map((c) => c.header));
    worksheet.addRow(columns.map((c) => c.example));
    worksheet.getRow(1).font = { bold: true };
    worksheet.columns.forEach((col) => {
      col.width = 22;
    });
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }
}

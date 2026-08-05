import { ImportModule } from '../../../../../common/enums/import-module.enum';
import { ParsedRow } from '../file-parser.service';
import { RowResult } from '../../row-result';

export interface ModuleImporter {
  readonly module: ImportModule;

  /** Dry-run: maps + validates every row against the module's real DTO/business rules. Never writes. */
  validateRows(rows: ParsedRow[]): Promise<RowResult[]>;

  /** Inserts only VALID rows via the module's real create path, in a single transaction. Returns count inserted. */
  commitRows(validRows: RowResult[], userId: string): Promise<number>;
}

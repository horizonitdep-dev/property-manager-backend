import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RowResult } from '../../row-result';

export type FieldErrors = { field: string; message: string }[];

/** Maps a human label (case-insensitive, trimmed) to its enum value. Unrecognized/blank → null. */
export function mapEnumLabel<T extends string>(
  value: string | null,
  labelMap: Record<string, T>,
): T | null {
  if (value === null) return null;
  const key = value.trim().toLowerCase();
  return labelMap[key] ?? null;
}

export function allowedLabelsMessage(labelMap: Record<string, string>): string {
  return Object.keys(labelMap).join(', ');
}

/** A required enum column: blank or unrecognized → pushes a clear, actionable error. */
export function mapRequiredEnumCell<T extends string>(
  value: string | null,
  field: string,
  labelMap: Record<string, T>,
  errors: FieldErrors,
): T | undefined {
  if (value === null) {
    errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  const mapped = mapEnumLabel(value, labelMap);
  if (mapped === null) {
    errors.push({
      field,
      message: `${field} '${value}' is not recognized. Allowed values: ${allowedLabelsMessage(labelMap)}`,
    });
    return undefined;
  }
  return mapped;
}

/** An optional enum column: blank is fine, unrecognized → pushes a clear, actionable error. */
export function mapOptionalEnumCell<T extends string>(
  value: string | null,
  field: string,
  labelMap: Record<string, T>,
  errors: FieldErrors,
): T | undefined {
  if (value === null) return undefined;
  const mapped = mapEnumLabel(value, labelMap);
  if (mapped === null) {
    errors.push({
      field,
      message: `${field} '${value}' is not recognized. Allowed values: ${allowedLabelsMessage(labelMap)}`,
    });
    return undefined;
  }
  return mapped;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Accepts ISO (YYYY-MM-DD, e.g. what our own file-parser emits for XLSX date cells),
 * DD/MM/YYYY, or a raw Excel serial day number (what a CSV cell looks like if the user
 * copy-pasted a date cell without Excel reformatting it as text). Returns a normalized
 * ISO date string, or null if unparsable — the DTO's own @IsDateString() only accepts
 * ISO, so this is format normalization, not a business rule; it must run before the DTO.
 */
export function parseImportDate(value: string): string | null {
  const trimmed = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return isValidYmd(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
  }

  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (dmy) {
    const [, d, m, y] = dmy;
    const day = Number(d);
    const month = Number(m);
    const year = Number(y);
    return isValidYmd(year, month, day)
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  }

  if (/^\d+$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial > 0) {
      // Excel's epoch is 1899-12-30 (it preserves the historical 1900 leap-year bug).
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  return null;
}

/** A date column: blank passes through (let the DTO/service decide if that's allowed);
 * a present-but-unparsable value pushes a clear, actionable error. */
export function mapDateCell(value: string | null, field: string, errors: FieldErrors): string | undefined {
  if (value === null) return undefined;
  const parsed = parseImportDate(value);
  if (parsed === null) {
    errors.push({
      field,
      message: `${field} '${value}' is not a valid date. Use YYYY-MM-DD, DD/MM/YYYY, or an Excel date.`,
    });
    return undefined;
  }
  return parsed;
}

/**
 * Runs a mapped row through the module's real Create DTO + class-validator pipeline —
 * the single source of truth for required-ness, ranges, lengths, and formats. Importers
 * must not re-implement these checks; they only pre-process what a DTO structurally can't
 * do (enum label mapping, reference resolution).
 *
 * Returns the coerced instance (numeric strings converted to numbers, etc.) alongside any
 * errors — callers must persist THIS as the row's data, not the raw string cells, or a
 * later commit would hand Prisma strings for numeric columns.
 */
export async function validateAgainstDto<T extends object>(
  dtoClass: new () => T,
  plain: Record<string, unknown>,
): Promise<{ errors: FieldErrors; value: T }> {
  const instance = plainToInstance(dtoClass, plain, { enableImplicitConversion: true });
  const violations = await validate(instance as object, { whitelist: true });

  const errors: FieldErrors = [];
  for (const violation of violations) {
    if (violation.constraints) {
      for (const message of Object.values(violation.constraints)) {
        errors.push({ field: violation.property, message });
      }
    }
  }
  return { errors, value: instance };
}

export function buildRowResult(
  rowNumber: number,
  data: Record<string, unknown>,
  errors: FieldErrors,
  resolvedRefs?: Record<string, string>,
): RowResult {
  return {
    rowNumber,
    data,
    status: errors.length > 0 ? 'ERROR' : 'VALID',
    errors,
    ...(resolvedRefs ? { resolvedRefs } : {}),
  };
}

/** Tracks first-seen row per duplicate key; flags every later row sharing that key. */
export class DuplicateTracker {
  private readonly seen = new Map<string, number>();

  /** Returns the first rowNumber that used this key, or null if this is the first occurrence. */
  check(key: string, rowNumber: number): number | null {
    const first = this.seen.get(key);
    if (first !== undefined) return first;
    this.seen.set(key, rowNumber);
    return null;
  }
}

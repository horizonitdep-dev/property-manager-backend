import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto';

/**
 * The source fields are omitted rather than made optional: they identify which
 * module owns the row, and letting the UI change them would let a hand-edited
 * expense masquerade as one created by Services. When Services is built it will
 * update its own rows through a dedicated service method, not this DTO.
 *
 * ExpensesService additionally refuses the whole request when the stored
 * sourceType is not GENERAL — UI edits only apply to manually entered expenses
 * (spec §6).
 */
export class UpdateExpenseDto extends PartialType(
  OmitType(CreateExpenseDto, ['sourceType', 'sourceRefId', 'sourceRefType'] as const),
) {}

import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentKind } from '../../../../../common/enums/payment-kind.enum';
import { CreateChequeDto } from './create-cheque.dto';

export class DepositChequeDto {
  @ApiProperty({ example: '2026-04-02', description: 'Date the cheque was banked' })
  @IsDateString()
  depositedOn!: string;
}

export class ClearChequeDto {
  @ApiProperty({ example: '2026-04-04', description: 'Date the bank confirmed clearance' })
  @IsDateString()
  clearedOn!: string;

  @ApiPropertyOptional({
    enum: PaymentKind,
    default: PaymentKind.RENT,
    description: 'Kind for the Payment this creates. Defaults to RENT; override for a deposit cheque.',
  })
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @ApiPropertyOptional({ description: 'Notes recorded on the created Payment, not on the cheque' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class BounceChequeDto {
  @ApiProperty({ example: '2026-04-05' })
  @IsDateString()
  bouncedOn!: string;

  @ApiProperty({ example: 'Insufficient funds' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  bounceReason!: string;
}

/**
 * The replacement cheque's own details. `contractId` is deliberately omitted — a
 * replacement always belongs to the same contract as the cheque it replaces, and
 * accepting it here would allow moving money between leases by accident.
 *
 * The amount may legitimately differ from the original (partial settlement, or
 * the tenant covering bank charges too).
 */
export class ReplaceChequeDto extends OmitType(CreateChequeDto, ['contractId'] as const) {
  @ApiPropertyOptional({ description: 'Note recorded on the OLD cheque, explaining the replacement' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  replacementNotes?: string;
}

export class CancelChequeDto {
  @ApiPropertyOptional({ description: 'Why it was voided — recorded on the cheque notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

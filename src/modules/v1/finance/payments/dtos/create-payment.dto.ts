import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaymentKind } from '../../../../../common/enums/payment-kind.enum';
import { PaymentMethod } from '../../../../../common/enums/payment-method.enum';

export class CreatePaymentDto {
  @ApiProperty({ description: 'The contract this money was received against' })
  @IsUUID()
  contractId!: string;

  @ApiPropertyOptional({ enum: PaymentKind, default: PaymentKind.RENT })
  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @ApiProperty({
    example: 2000.0,
    description:
      'Always entered as a positive number. A REFUND is money going out — reports treat it as outgoing, the sign is not carried here.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  paidOn!: string;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.BANK_TRANSFER })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Start of the period this money covers' })
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional({ example: '2026-03-31', description: 'End of the period this money covers' })
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @ApiPropertyOptional({ example: 'TRX-99881', description: 'Bank transaction id or receipt number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // chequeId is deliberately absent: a payment is only ever linked to a cheque by
  // POST /finance/cheques/:id/clear, which creates both sides atomically. Letting
  // callers set it here would allow a payment pointing at an uncleared cheque.
}

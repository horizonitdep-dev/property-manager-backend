import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateChequeDto {
  @ApiProperty({ description: 'The contract this cheque pays against' })
  @IsUUID()
  contractId!: string;

  @ApiProperty({ example: '000123' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  chequeNumber!: string;

  @ApiProperty({ example: 'First Abu Dhabi Bank' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  bankName!: string;

  @ApiProperty({ example: 7000.0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({
    example: '2026-04-01',
    description: 'The date written on the cheque — when it becomes bankable',
  })
  @IsDateString()
  chequeDate!: string;

  @ApiProperty({ example: '2026-01-05', description: 'When the landlord took possession of it' })
  @IsDateString()
  receivedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // status is not settable: a cheque always starts HELD and moves only through
  // the lifecycle endpoints (spec §5.1).
}

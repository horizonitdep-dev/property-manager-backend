import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsIn,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
  IsNumber,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { PaymentFrequency } from '../../../../common/enums/payment-frequency.enum';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { RequiredWhenCheques, IsAfterStartDate } from '../validators/contract-dates.validator';

const isProvided = (value: unknown) => value !== undefined && value !== null && value !== '';

/** Only these two are settable on create — TERMINATED is only ever reached via POST /contracts/:id/terminate. */
const CREATABLE_STATUSES = [ContractStatus.DRAFT, ContractStatus.ACTIVE] as const;

export class CreateContractDto {
  @ApiProperty({ example: '202303980216', minLength: 1, maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  contractNumber!: string;

  @ApiProperty({ example: 'b1f4c8b0-6f1a-4e2d-9c3a-2a1b3c4d5e6f' })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ example: 'c2f4c8b0-6f1a-4e2d-9c3a-2a1b3c4d5e6f' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: '2025-01-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2025-12-31' })
  @IsDateString()
  @IsAfterStartDate()
  endDate!: string;

  @ApiProperty({ example: 28000, minimum: 0 })
  @IsNumber()
  @Min(0)
  annualRent!: number;

  @ApiProperty({ example: 2330, minimum: 0 })
  @IsNumber()
  @Min(0)
  monthlyRent!: number;

  @ApiProperty({ enum: PaymentFrequency, example: PaymentFrequency.MONTHLY })
  @IsEnum(PaymentFrequency)
  paymentFrequency!: PaymentFrequency;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 24 })
  @RequiredWhenCheques()
  @ValidateIf((o) => isProvided(o.numberOfCheques))
  @IsInt()
  @Min(1)
  @Max(24)
  numberOfCheques?: number;

  @ApiPropertyOptional({ example: 5000, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  securityDeposit?: number;

  @ApiPropertyOptional({
    enum: CREATABLE_STATUSES,
    example: ContractStatus.DRAFT,
    default: ContractStatus.DRAFT,
    description: 'Only DRAFT or ACTIVE may be set on create. TERMINATED is set via POST /contracts/:id/terminate.',
  })
  @IsOptional()
  @IsIn(CREATABLE_STATUSES)
  status?: ContractStatus;

  @ApiPropertyOptional({ description: 'Set internally by the renewal flow (POST /contracts/:id/renew)' })
  @IsOptional()
  @IsUUID()
  renewedFromId?: string;

  @ApiPropertyOptional({ example: 'Tenant requested early move-in' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

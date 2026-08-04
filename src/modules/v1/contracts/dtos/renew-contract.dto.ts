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
  IsNumber,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { PaymentFrequency } from '../../../../common/enums/payment-frequency.enum';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { RequiredWhenCheques, IsAfterStartDate } from '../validators/contract-dates.validator';

const isProvided = (value: unknown) => value !== undefined && value !== null && value !== '';

/** Same restriction as CreateContractDto — TERMINATED is only ever reached via the dedicated endpoint. */
const CREATABLE_STATUSES = [ContractStatus.DRAFT, ContractStatus.ACTIVE] as const;

/**
 * Creates a NEW contract linked to the source via renewedFromId.
 * tenantId and propertyId are always taken from the source contract (a renewal
 * doesn't reassign the lease) — everything below is prefilled from the source
 * and overridable here.
 */
export class RenewContractDto {
  @ApiProperty({ example: '202303980216-R1', minLength: 1, maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  contractNumber!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  @IsAfterStartDate()
  endDate!: string;

  @ApiPropertyOptional({ example: 28000, minimum: 0, description: 'Defaults to the source contract\'s annualRent' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualRent?: number;

  @ApiPropertyOptional({ example: 2330, minimum: 0, description: 'Defaults to the source contract\'s monthlyRent' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyRent?: number;

  @ApiPropertyOptional({ enum: PaymentFrequency, description: 'Defaults to the source contract\'s paymentFrequency' })
  @IsOptional()
  @IsEnum(PaymentFrequency)
  paymentFrequency?: PaymentFrequency;

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
  })
  @IsOptional()
  @IsIn(CREATABLE_STATUSES)
  status?: ContractStatus;

  @ApiPropertyOptional({ example: 'Renewed at the same rate' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

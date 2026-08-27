import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TenantType } from '../../../../common/enums/tenant-type.enum';

/**
 * Mirrors the §5.3 extraction schema exactly.
 *
 * This validates the model's raw JSON structurally, BEFORE any business
 * normalization — it is the guardrail against a malformed or partial response,
 * not a replacement for the module DTOs (CreateContractDto etc.), which still run
 * against the normalized candidate afterwards.
 *
 * Deliberately NOT a copy of ExtractedContractDto: Green Contracts carry no DMT
 * contract number and no property registration number, so requiring either here
 * would reject every valid Green Contract.
 */

export class ExtractedGreenBuildingDto {
  /** e.g. "R6", "R19". The only building identifier a Green Contract carries. */
  @IsString()
  @MinLength(1)
  code!: string;

  /** A name sitting between unit and code — "Flat 07 - Mezan - R19" yields "Mezan". */
  @IsOptional()
  @IsString()
  nameQualifier?: string | null;
}

export class ExtractedGreenUnitDto {
  @IsString()
  @MinLength(1)
  unitNumber!: string;
}

export class ExtractedGreenTenantDto {
  /** Determined by the model from the tenant line: a CN/trade licence means
   * COMPANY, an Emirates ID means INDIVIDUAL. The same template covers both. */
  @IsEnum(TenantType)
  type!: TenantType;

  @IsOptional()
  @IsString()
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  nameAr?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  emiratesIdNumber?: string | null;

  @IsOptional()
  @IsString()
  tradeLicenseNumber?: string | null;

  @IsOptional()
  @IsString()
  authorizedPersonNameEn?: string | null;

  @IsOptional()
  @IsString()
  authorizedPersonNameAr?: string | null;
}

export class ExtractedGreenContractDetailsDto {
  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  annualRent!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyRent?: number | null;

  /** The payment phrase verbatim, e.g. "4 installments" or "2250 AED Monthly".
   * Mapping to the PaymentFrequency enum happens in the service, never in the
   * prompt — the model should report what it sees, not interpret it. */
  @IsString()
  paymentFrequencyRaw!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  installmentsCount?: number | null;

  @IsOptional()
  @IsString()
  observations?: string | null;

  @IsOptional()
  @IsString()
  utilitiesNote?: string | null;
}

export class ExtractedGreenContractDto {
  /** The landlord's own reference on the document, if any. Not the contract
   * number — that is derived as GC-{buildingCode}-{unitNumber}. */
  @IsOptional()
  @IsString()
  internalReference?: string | null;

  @ValidateNested()
  @Type(() => ExtractedGreenBuildingDto)
  building!: ExtractedGreenBuildingDto;

  @ValidateNested()
  @Type(() => ExtractedGreenUnitDto)
  unit!: ExtractedGreenUnitDto;

  @ValidateNested()
  @Type(() => ExtractedGreenTenantDto)
  tenant!: ExtractedGreenTenantDto;

  @ValidateNested()
  @Type(() => ExtractedGreenContractDetailsDto)
  contract!: ExtractedGreenContractDetailsDto;
}

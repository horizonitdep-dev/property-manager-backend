import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';

/**
 * Mirrors the §6 extraction schema exactly. This validates the LLM's raw JSON
 * output structurally (shape only) BEFORE any business normalization — it is
 * the guardrail against a malformed or partial model response, not a
 * replacement for the module DTOs (CreateBuildingDto etc.), which still run
 * against the normalized candidate afterward.
 */
export class ExtractedContractDetailsDto {
  @IsString()
  contractNumber!: string;

  @IsOptional()
  @IsString()
  issueDate?: string | null;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsNumber()
  annualRent!: number;

  @IsOptional()
  @IsNumber()
  contractValue?: number | null;

  @IsOptional()
  @IsNumber()
  securityDeposit?: number | null;

  @IsString()
  paymentMethod!: string;

  @IsOptional()
  @IsNumber()
  numberOfPayments?: number | null;

  @IsOptional()
  @IsString()
  contractType?: string | null;

  @IsOptional()
  @IsNumber()
  waterElectricityBill?: number | null;

  @IsOptional()
  @IsString()
  occupants?: string | null;
}

export class ExtractedTenantDto {
  @IsOptional()
  @IsString()
  companyNameEn?: string | null;

  @IsOptional()
  @IsString()
  companyNameAr?: string | null;

  @IsOptional()
  @IsString()
  individualNameEn?: string | null;

  @IsOptional()
  @IsString()
  individualNameAr?: string | null;

  @IsOptional()
  @IsString()
  tradeLicenseNumber?: string | null;

  /**
   * Individual identity fields. Residential DMT contracts print the tenant's
   * Emirates ID (and sometimes passport/nationality) in the Tenant Details
   * section; commercial ones frequently don't. Extracted when present so
   * INDIVIDUAL tenants import with a real identity rather than a blank one —
   * see PDF_IMPORT_OPTIONAL_INDIVIDUAL_FIELDS for what happens when absent.
   */
  @IsOptional()
  @IsString()
  emiratesIdNumber?: string | null;

  @IsOptional()
  @IsString()
  passportNumber?: string | null;

  @IsOptional()
  @IsString()
  nationality?: string | null;

  @IsOptional()
  @IsString()
  mobile?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;
}

export class ExtractedBuildingDto {
  @IsString()
  propertyRegistrationNo!: string;

  @IsOptional()
  @IsString()
  zone?: string | null;

  @IsOptional()
  @IsString()
  sector?: string | null;

  @IsOptional()
  @IsString()
  plotNo?: string | null;

  @IsOptional()
  @IsString()
  onwaniAddress?: string | null;
}

export class ExtractedUnitDto {
  @IsString()
  unitNumber!: string;

  @IsString()
  unitType!: string;

  @IsOptional()
  @IsNumber()
  areaSqm?: number | null;

  @IsOptional()
  @IsString()
  premiseNo?: string | null;

  @IsOptional()
  @IsString()
  unitRegNo?: string | null;
}

export class ExtractedContractDto {
  @ValidateNested()
  @Type(() => ExtractedContractDetailsDto)
  contract!: ExtractedContractDetailsDto;

  @ValidateNested()
  @Type(() => ExtractedTenantDto)
  tenant!: ExtractedTenantDto;

  @ValidateNested()
  @Type(() => ExtractedBuildingDto)
  building!: ExtractedBuildingDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtractedUnitDto)
  units!: ExtractedUnitDto[];
}

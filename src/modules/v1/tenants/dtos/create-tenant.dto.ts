import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  MinLength,
  IsEnum,
  IsOptional,
  IsEmail,
  IsDateString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { TenantType } from '../../../../common/enums/tenant-type.enum';
import { TenantStatus } from '../../../../common/enums/tenant-status.enum';
import { RequiredForTenantType } from '../validators/tenant-type-fields.validator';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;
const isProvided = (value: unknown) => value !== undefined && value !== null && value !== '';

export class CreateTenantDto {
  @ApiProperty({ enum: TenantType, example: TenantType.INDIVIDUAL })
  @IsEnum(TenantType)
  tenantType!: TenantType;

  @ApiProperty({ example: 'Ahmed Al Mansoori', minLength: 1, maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(150)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'أحمد المنصوري', minLength: 1, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nameAr?: string;

  @ApiProperty({ example: '+971501234567' })
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid international phone number' })
  phone!: string;

  @ApiPropertyOptional({ example: '+971501234568' })
  @ValidateIf((o) => isProvided(o.alternatePhone))
  @IsString()
  @Matches(PHONE_REGEX, { message: 'alternatePhone must be a valid international phone number' })
  alternatePhone?: string;

  @ApiPropertyOptional({ example: 'tenant@example.com' })
  @ValidateIf((o) => isProvided(o.email))
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'UAE' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  // INDIVIDUAL-only — required when tenantType = INDIVIDUAL
  @ApiPropertyOptional({ example: '784-1990-1234567-1' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.emiratesIdNumber))
  @IsString()
  @MaxLength(50)
  emiratesIdNumber?: string;

  @ApiPropertyOptional({ example: '2027-01-31' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.emiratesIdExpiry))
  @IsDateString()
  emiratesIdExpiry?: string;

  @ApiPropertyOptional({ example: 'P1234567' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.passportNumber))
  @IsString()
  @MaxLength(50)
  passportNumber?: string;

  @ApiPropertyOptional({ example: '2029-06-30' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.passportExpiry))
  @IsDateString()
  passportExpiry?: string;

  // COMPANY-only — required when tenantType = COMPANY
  @ApiPropertyOptional({ example: 'CN-1234567' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.tradeLicenseNumber))
  @IsString()
  @MaxLength(50)
  tradeLicenseNumber?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.tradeLicenseExpiry))
  @IsDateString()
  tradeLicenseExpiry?: string;

  @ApiPropertyOptional({ example: 'Khalid Al Suwaidi' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.authorizedPersonNameEn))
  @IsString()
  @MaxLength(150)
  authorizedPersonNameEn?: string;

  @ApiPropertyOptional({ example: 'خالد السويدي' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  authorizedPersonNameAr?: string;

  @ApiPropertyOptional({ example: 'General Manager' })
  @RequiredForTenantType()
  @ValidateIf((o) => isProvided(o.authorizedPersonOccupation))
  @IsString()
  @MaxLength(100)
  authorizedPersonOccupation?: string;

  @ApiPropertyOptional({ example: '+971501234569' })
  @ValidateIf((o) => isProvided(o.authorizedPersonPhone))
  @IsString()
  @Matches(PHONE_REGEX, {
    message: 'authorizedPersonPhone must be a valid international phone number',
  })
  authorizedPersonPhone?: string;

  @ApiPropertyOptional({
    enum: TenantStatus,
    example: TenantStatus.ACTIVE,
    default: TenantStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({ example: 'Referred by existing tenant' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentFrequency } from '../../../../common/enums/payment-frequency.enum';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { ContractSource } from '../../../../common/enums/contract-source.enum';
import { TenantType } from '../../../../common/enums/tenant-type.enum';
import { ContractDocumentType } from '../../../../common/enums/contract-document-type.enum';
import { PropertyBuildingSummaryDto } from '../../properties/dtos/property-response.dto';

export class ContractDocumentSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ContractDocumentType })
  documentType!: ContractDocumentType;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  uploadedAt!: Date;

  @ApiProperty()
  uploadedById!: string;
}

export class ContractTenantSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nameEn!: string;

  @ApiPropertyOptional()
  nameAr?: string | null;

  @ApiProperty({ enum: TenantType })
  tenantType!: TenantType;
}

export class ContractPropertySummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  unitNumber!: string;

  @ApiProperty({ type: PropertyBuildingSummaryDto })
  building!: PropertyBuildingSummaryDto;
}

export class ContractResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  contractNumber!: string;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty()
  endDate!: Date;

  @ApiProperty()
  annualRent!: number;

  @ApiProperty()
  monthlyRent!: number;

  @ApiProperty({ enum: PaymentFrequency })
  paymentFrequency!: PaymentFrequency;

  @ApiPropertyOptional()
  numberOfCheques?: number | null;

  @ApiPropertyOptional()
  securityDeposit?: number | null;

  @ApiProperty({
    enum: ContractStatus,
    description: 'Effective status — computed from storedStatus + endDate, never stored directly for EXPIRING_SOON/EXPIRED',
  })
  status!: ContractStatus;

  @ApiProperty({
    enum: ContractStatus,
    description: 'Raw manual status as stored in the DB (DRAFT | ACTIVE | TERMINATED) — for the edit form',
  })
  storedStatus!: ContractStatus;

  @ApiProperty({
    enum: ContractSource,
    description:
      'Which ingestion path created this contract. Set by the importer that created it; MANUAL for ' +
      'contracts entered through the API. Correctable by a MANAGER via PATCH.',
  })
  source!: ContractSource;

  @ApiPropertyOptional()
  renewedFromId?: string | null;

  @ApiProperty({ type: ContractTenantSummaryDto })
  tenant!: ContractTenantSummaryDto;

  @ApiProperty({ type: ContractPropertySummaryDto })
  property!: ContractPropertySummaryDto;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantType } from '../../../../common/enums/tenant-type.enum';
import { TenantStatus } from '../../../../common/enums/tenant-status.enum';
import { DocumentType } from '../../../../common/enums/document-type.enum';

export class TenantDocumentSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DocumentType })
  documentType!: DocumentType;

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

/**
 * Detail-endpoint shape. Includes ID/licence numbers and document metadata
 * (never file content) — only reachable via GET /tenants/:id, not the list.
 */
export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TenantType })
  tenantType!: TenantType;

  @ApiProperty()
  nameEn!: string;

  @ApiPropertyOptional()
  nameAr?: string | null;

  @ApiPropertyOptional({ description: 'Absent when the source document carried no phone number' })
  phone?: string | null;

  @ApiPropertyOptional()
  alternatePhone?: string | null;

  @ApiPropertyOptional()
  email?: string | null;

  @ApiPropertyOptional()
  nationality?: string | null;

  @ApiPropertyOptional()
  emiratesIdNumber?: string | null;

  @ApiPropertyOptional()
  emiratesIdExpiry?: Date | null;

  @ApiPropertyOptional()
  passportNumber?: string | null;

  @ApiPropertyOptional()
  passportExpiry?: Date | null;

  @ApiPropertyOptional()
  tradeLicenseNumber?: string | null;

  @ApiPropertyOptional()
  tradeLicenseExpiry?: Date | null;

  @ApiPropertyOptional()
  authorizedPersonNameEn?: string | null;

  @ApiPropertyOptional()
  authorizedPersonNameAr?: string | null;

  @ApiPropertyOptional()
  authorizedPersonOccupation?: string | null;

  @ApiPropertyOptional()
  authorizedPersonPhone?: string | null;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiProperty({ type: [TenantDocumentSummaryDto] })
  documents!: TenantDocumentSummaryDto[];

  @ApiProperty({
    description:
      'True for a COMPANY tenant imported without trade licence expiry / authorized person details — complete these fields via PATCH.',
  })
  profileIncomplete!: boolean;

  @ApiProperty()
  createdById!: string;

  @ApiPropertyOptional()
  updatedById?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional()
  deletedAt?: Date | null;
}

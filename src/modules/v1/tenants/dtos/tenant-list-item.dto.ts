import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantType } from '../../../../common/enums/tenant-type.enum';
import { TenantStatus } from '../../../../common/enums/tenant-status.enum';

/**
 * List-endpoint shape. Deliberately omits emiratesIdNumber, passportNumber,
 * tradeLicenseNumber and every other sensitive ID/licence field — those are
 * only ever returned from the single-tenant detail endpoint.
 */
export class TenantListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TenantType })
  tenantType!: TenantType;

  @ApiProperty()
  nameEn!: string;

  @ApiPropertyOptional()
  nameAr?: string | null;

  @ApiProperty()
  phone!: string;

  @ApiPropertyOptional()
  email?: string | null;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty()
  documentCount!: number;

  @ApiProperty()
  createdAt!: Date;
}

import { PartialType } from '@nestjs/swagger';
import { CreateTenantDto } from './create-tenant.dto';

/**
 * PartialType makes every field (incl. the conditionally-required ones) optional
 * at the DTO level. The INDIVIDUAL/COMPANY requirement is re-checked in
 * TenantsService.update() against the *merged* record, since a PATCH payload
 * alone doesn't carry enough context to validate the rule.
 */
export class UpdateTenantDto extends PartialType(CreateTenantDto) {}

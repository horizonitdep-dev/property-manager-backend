import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { TenantType } from '../../../../common/enums/tenant-type.enum';

const INDIVIDUAL_REQUIRED_FIELDS = [
  'emiratesIdNumber',
  'emiratesIdExpiry',
  'passportNumber',
  'passportExpiry',
] as const;

const COMPANY_REQUIRED_FIELDS = [
  'tradeLicenseNumber',
  'tradeLicenseExpiry',
  'authorizedPersonNameEn',
  'authorizedPersonOccupation',
] as const;

export function getRequiredFieldsForTenantType(tenantType: TenantType): readonly string[] {
  return tenantType === TenantType.INDIVIDUAL
    ? INDIVIDUAL_REQUIRED_FIELDS
    : COMPANY_REQUIRED_FIELDS;
}

/**
 * Single source of truth for the INDIVIDUAL vs COMPANY conditional requirements.
 * Used by the DTO-level constraint below (create) and directly by TenantsService
 * against the merged record (update), since a PATCH payload alone can't be
 * validated against this rule.
 *
 * `tenantType` is typed as `string` rather than the `TenantType` enum because
 * callers merge Prisma results (which use `@prisma/client`'s generated
 * `$Enums.TenantType`) with DTOs (which use this app's own `TenantType` enum) —
 * two structurally distinct types with identical string values.
 */
export function getMissingTenantTypeFields(data: { tenantType?: string | null }): string[] {
  if (!data.tenantType) return [];
  const required = getRequiredFieldsForTenantType(data.tenantType as TenantType);
  const record = data as Record<string, unknown>;
  return required.filter((field) => {
    const value = record[field];
    return value === undefined || value === null || value === '';
  });
}

@ValidatorConstraint({ name: 'requiredForTenantType', async: false })
class RequiredForTenantTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { tenantType?: TenantType };
    if (!obj.tenantType) return true; // let @IsEnum on tenantType report that separately

    const required = getRequiredFieldsForTenantType(obj.tenantType);
    if (!required.includes(args.property)) return true;

    return value !== undefined && value !== null && value !== '';
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as { tenantType?: TenantType };
    return `${args.property} is required when tenantType is ${obj.tenantType}`;
  }
}

/** Marks a field as required only when the DTO's tenantType calls for it. */
export function RequiredForTenantType(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: RequiredForTenantTypeConstraint,
    });
  };
}

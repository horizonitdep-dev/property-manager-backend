import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PaymentFrequency } from '../../../../common/enums/payment-frequency.enum';

const isProvided = (value: unknown) => value !== undefined && value !== null && value !== '';

/**
 * Single source of truth for the CHEQUES -> numberOfCheques requirement.
 * Used by the DTO-level constraint below (create) and directly by
 * ContractsService against the merged record (update/renew), since a PATCH
 * payload alone can't be validated against this rule.
 */
export function isNumberOfChequesMissing(data: {
  paymentFrequency?: string | null;
  numberOfCheques?: number | null;
}): boolean {
  return data.paymentFrequency === PaymentFrequency.CHEQUES && !isProvided(data.numberOfCheques);
}

@ValidatorConstraint({ name: 'requiredWhenCheques', async: false })
class RequiredWhenChequesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { paymentFrequency?: PaymentFrequency };
    if (obj.paymentFrequency !== PaymentFrequency.CHEQUES) return true;
    return isProvided(value);
  }

  defaultMessage(): string {
    return 'numberOfCheques is required when paymentFrequency is CHEQUES';
  }
}

/** Marks numberOfCheques as required only when the DTO's paymentFrequency is CHEQUES. */
export function RequiredWhenCheques(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: RequiredWhenChequesConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isAfterStartDate', async: false })
class IsAfterStartDateConstraint implements ValidatorConstraintInterface {
  validate(endDate: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { startDate?: string };
    if (!obj.startDate || typeof endDate !== 'string') return true; // let @IsDateString report format errors separately
    return new Date(endDate) > new Date(obj.startDate);
  }

  defaultMessage(): string {
    return 'endDate must be after startDate';
  }
}

/** Marks a date field as required to be strictly after the DTO's startDate. */
export function IsAfterStartDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsAfterStartDateConstraint,
    });
  };
}

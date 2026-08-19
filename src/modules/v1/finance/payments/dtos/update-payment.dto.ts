import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePaymentDto } from './create-payment.dto';

/**
 * `contractId` is omitted before the PartialType: moving a payment to a different
 * contract would silently rewrite two contracts' cash history, so it is not
 * editable — soft-delete and re-enter instead.
 *
 * `amount` and `paidOn` ARE present here because they are editable on a manual
 * payment, but PaymentsService rejects them (409) when the payment came from a
 * cleared cheque, where the cheque is the source of truth (spec §5.2).
 */
export class UpdatePaymentDto extends PartialType(OmitType(CreatePaymentDto, ['contractId'] as const)) {}

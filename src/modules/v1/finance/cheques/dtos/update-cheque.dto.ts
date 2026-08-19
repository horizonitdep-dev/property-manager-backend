import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateChequeDto } from './create-cheque.dto';

/**
 * Metadata edits only, and only while the cheque is still HELD — once it has been
 * to the bank the record has to match what the bank saw, so ChequesService
 * rejects any edit past DEPOSITED with a 409 naming the current status (§6).
 *
 * `contractId` is omitted: re-pointing a cheque at a different lease would move
 * money between contracts silently.
 */
export class UpdateChequeDto extends PartialType(OmitType(CreateChequeDto, ['contractId'] as const)) {}

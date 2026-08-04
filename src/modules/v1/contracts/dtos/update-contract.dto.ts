import { PartialType } from '@nestjs/swagger';
import { CreateContractDto } from './create-contract.dto';

/**
 * PartialType makes every field optional at the DTO level, including status —
 * which stays restricted to DRAFT|ACTIVE (inherited from CreateContractDto's
 * @IsIn) so TERMINATED can only ever be reached via POST /contracts/:id/terminate,
 * even through this general-purpose PATCH.
 *
 * The endDate>startDate and CHEQUES->numberOfCheques rules are re-checked in
 * ContractsService.update() against the *merged* record, since a PATCH payload
 * alone doesn't carry enough context to validate them.
 */
export class UpdateContractDto extends PartialType(CreateContractDto) {}

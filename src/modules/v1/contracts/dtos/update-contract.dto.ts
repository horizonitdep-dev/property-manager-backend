import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateContractDto } from './create-contract.dto';
import { ContractSource } from '../../../../common/enums/contract-source.enum';

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
export class UpdateContractDto extends PartialType(CreateContractDto) {
  /**
   * Declared here rather than inherited, because `source` is deliberately absent
   * from CreateContractDto — an importer sets it when it creates the contract, so
   * allowing it on POST would let a caller fake the provenance. It IS editable
   * here so a MANAGER can correct anything the backfill misclassified (spec §8.4).
   */
  @ApiPropertyOptional({
    enum: ContractSource,
    description: 'Correct the recorded origin of this contract (Manager only)',
  })
  @IsOptional()
  @IsEnum(ContractSource)
  source?: ContractSource;
}

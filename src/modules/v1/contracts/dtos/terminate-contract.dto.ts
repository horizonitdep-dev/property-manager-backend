import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * No new columns for termination metadata (schema was already reviewed at the
 * migration checkpoint) — terminationReason/terminationDate, if given, are
 * appended to the contract's `notes` field instead.
 */
export class TerminateContractDto {
  @ApiPropertyOptional({ example: 'Tenant vacated early by mutual agreement' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  terminationReason?: string;

  @ApiPropertyOptional({ example: '2026-03-15' })
  @IsOptional()
  @IsDateString()
  terminationDate?: string;
}

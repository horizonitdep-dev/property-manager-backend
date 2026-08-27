import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class GreenContractCommitDto {
  @ApiProperty({ description: 'The sessionId returned by POST /import/green-contract/validate' })
  @IsUUID()
  sessionId!: string;
}

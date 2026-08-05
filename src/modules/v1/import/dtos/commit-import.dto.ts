import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CommitImportDto {
  @ApiProperty({ description: 'The ImportSession id returned by the validate step' })
  @IsUUID()
  sessionId!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CommitPdfImportDto {
  @ApiProperty({ description: 'The contractSessionId returned by /import/pdf/validate' })
  @IsUUID()
  contractSessionId!: string;
}

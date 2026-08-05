import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportModule } from '../../../../common/enums/import-module.enum';
import { ImportStatus } from '../../../../common/enums/import-status.enum';

export class ImportRowErrorDto {
  @ApiProperty()
  field!: string;

  @ApiProperty()
  message!: string;
}

export class ImportRowResultDto {
  @ApiProperty({ description: "1-based, matches the row number in the user's spreadsheet" })
  rowNumber!: number;

  @ApiProperty({ enum: ['VALID', 'ERROR'] })
  status!: 'VALID' | 'ERROR';

  @ApiProperty({ type: [ImportRowErrorDto] })
  errors!: ImportRowErrorDto[];

  @ApiPropertyOptional()
  data?: Record<string, unknown>;
}

export class ImportSessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ImportModule })
  module!: ImportModule;

  @ApiProperty({ enum: ImportStatus })
  status!: ImportStatus;

  @ApiProperty()
  originalName!: string;

  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  validRows!: number;

  @ApiProperty()
  errorRows!: number;

  @ApiProperty({ type: [ImportRowResultDto] })
  rows!: ImportRowResultDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  committedAt?: Date | null;
}

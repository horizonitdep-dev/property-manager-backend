import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DocumentType } from '../../../../common/enums/document-type.enum';

export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentType, example: DocumentType.EMIRATES_ID })
  @IsEnum(DocumentType)
  documentType!: DocumentType;
}

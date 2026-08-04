import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ContractDocumentType } from '../../../../common/enums/contract-document-type.enum';

export class UploadContractDocumentDto {
  @ApiProperty({ enum: ContractDocumentType, example: ContractDocumentType.SIGNED_CONTRACT })
  @IsEnum(ContractDocumentType)
  documentType!: ContractDocumentType;
}

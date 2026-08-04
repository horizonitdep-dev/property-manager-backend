import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ContractDocumentsService } from './contract-documents.service';
import { UploadContractDocumentDto } from './dtos/upload-contract-document.dto';
import { ContractDocumentSummaryDto } from './dtos/contract-response.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ContractDocumentType } from '../../../common/enums/contract-document-type.enum';

@ApiTags('Contracts')
@ApiBearerAuth('access-token')
@Controller({ path: 'contracts/:id/documents', version: '1' })
export class ContractDocumentsController {
  constructor(private readonly contractDocumentsService: ContractDocumentsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: { type: 'string', enum: Object.values(ContractDocumentType) },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a contract document (Manager only)' })
  @ApiResponse({ status: 201, description: 'Document uploaded', type: ContractDocumentSummaryDto })
  @ApiResponse({ status: 400, description: 'Invalid file type or file too large' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  upload(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Body() dto: UploadContractDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractDocumentsService.upload(contractId, dto.documentType, file, userId);
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: "List a contract's document metadata" })
  @ApiResponse({ status: 200, description: 'Document list', type: [ContractDocumentSummaryDto] })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  findAll(@Param('id', ParseUUIDPipe) contractId: string) {
    return this.contractDocumentsService.findAllForContract(contractId);
  }

  @Get(':docId/url')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get a short-lived signed download URL for a document' })
  @ApiResponse({ status: 200, description: 'Signed URL generated' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  getSignedUrl(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.contractDocumentsService.getSignedUrl(contractId, docId);
  }

  @Delete(':docId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a contract document (Manager only)' })
  @ApiResponse({ status: 200, description: 'Document soft deleted' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  remove(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractDocumentsService.remove(contractId, docId, userId);
  }
}

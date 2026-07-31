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
import { TenantDocumentsService } from './tenant-documents.service';
import { UploadDocumentDto } from './dtos/upload-document.dto';
import { TenantDocumentSummaryDto } from './dtos/tenant-response.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { DocumentType } from '../../../common/enums/document-type.enum';

@ApiTags('Tenants')
@ApiBearerAuth('access-token')
@Controller({ path: 'tenants/:id/documents', version: '1' })
export class TenantDocumentsController {
  constructor(private readonly tenantDocumentsService: TenantDocumentsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: { type: 'string', enum: Object.values(DocumentType) },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a tenant document (Manager only)' })
  @ApiResponse({ status: 201, description: 'Document uploaded', type: TenantDocumentSummaryDto })
  @ApiResponse({ status: 400, description: 'Invalid file type or file too large' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  upload(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.tenantDocumentsService.upload(tenantId, dto.documentType, file, userId);
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: "List a tenant's document metadata" })
  @ApiResponse({ status: 200, description: 'Document list', type: [TenantDocumentSummaryDto] })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  findAll(@Param('id', ParseUUIDPipe) tenantId: string) {
    return this.tenantDocumentsService.findAllForTenant(tenantId);
  }

  @Get(':docId/url')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get a short-lived signed download URL for a document' })
  @ApiResponse({ status: 200, description: 'Signed URL generated' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  getSignedUrl(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.tenantDocumentsService.getSignedUrl(tenantId, docId);
  }

  @Delete(':docId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a tenant document (Manager only)' })
  @ApiResponse({ status: 200, description: 'Document soft deleted' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  remove(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.tenantDocumentsService.remove(tenantId, docId, userId);
  }
}

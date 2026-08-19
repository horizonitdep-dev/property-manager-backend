import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChequeAttachmentsService } from './cheque-attachments.service';
import { PaymentAttachmentSummaryDto } from '../payments/dtos/payment-response.dto';
import { UploadFinanceAttachmentDto } from '../shared/dtos/upload-finance-attachment.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';

@ApiTags('Finance / Cheques')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/cheques/:id/attachments', version: '1' })
export class ChequeAttachmentsController {
  constructor(private readonly attachmentsService: ChequeAttachmentsService) {}

  @Post()
  @Roles(UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: Object.values(FinanceAttachmentType) },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a cheque image or bank return slip (Manager only)',
    description: 'Defaults to CHEQUE_IMAGE. PDF/JPEG/PNG, max 10 MB, type sniffed from the bytes.',
  })
  @ApiResponse({ status: 201, description: 'Attachment uploaded', type: PaymentAttachmentSummaryDto })
  @ApiResponse({ status: 400, description: 'Missing file, unsupported type, or over 10 MB' })
  @ApiResponse({ status: 404, description: 'Cheque not found' })
  upload(
    @Param('id', ParseUUIDPipe) chequeId: string,
    @Body() dto: UploadFinanceAttachmentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachmentsService.upload(chequeId, dto.type, file, userId);
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: "List a cheque's attachment metadata" })
  @ApiResponse({ status: 200, description: 'Attachment list', type: [PaymentAttachmentSummaryDto] })
  @ApiResponse({ status: 404, description: 'Cheque not found' })
  findAll(@Param('id', ParseUUIDPipe) chequeId: string) {
    return this.attachmentsService.findAllForParent(chequeId);
  }

  @Get(':attId/url')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get a short-lived signed download URL' })
  @ApiResponse({ status: 200, description: 'Signed URL generated' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  getSignedUrl(
    @Param('id', ParseUUIDPipe) chequeId: string,
    @Param('attId', ParseUUIDPipe) attId: string,
  ) {
    return this.attachmentsService.getSignedUrl(chequeId, attId);
  }

  @Delete(':attId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete an attachment (Manager only)' })
  @ApiResponse({ status: 200, description: 'Attachment soft deleted' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  remove(
    @Param('id', ParseUUIDPipe) chequeId: string,
    @Param('attId', ParseUUIDPipe) attId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachmentsService.remove(chequeId, attId, userId);
  }
}

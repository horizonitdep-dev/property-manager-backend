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
import { PaymentAttachmentsService } from './payment-attachments.service';
import { PaymentAttachmentSummaryDto } from './dtos/payment-response.dto';
import { UploadFinanceAttachmentDto } from '../shared/dtos/upload-finance-attachment.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { FinanceAttachmentType } from '../../../../common/enums/finance-attachment-type.enum';

@ApiTags('Finance / Payments')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/payments/:id/attachments', version: '1' })
export class PaymentAttachmentsController {
  constructor(private readonly attachmentsService: PaymentAttachmentsService) {}

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
    summary: 'Upload a receipt against a payment (Manager only)',
    description: 'PDF/JPEG/PNG, max 10 MB. The real type is sniffed from the bytes, not the header.',
  })
  @ApiResponse({ status: 201, description: 'Attachment uploaded', type: PaymentAttachmentSummaryDto })
  @ApiResponse({ status: 400, description: 'Missing file, unsupported type, or over 10 MB' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  upload(
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Body() dto: UploadFinanceAttachmentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachmentsService.upload(paymentId, dto.type, file, userId);
  }

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: "List a payment's attachment metadata" })
  @ApiResponse({ status: 200, description: 'Attachment list', type: [PaymentAttachmentSummaryDto] })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  findAll(@Param('id', ParseUUIDPipe) paymentId: string) {
    return this.attachmentsService.findAllForParent(paymentId);
  }

  @Get(':attId/url')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Get a short-lived signed download URL',
    description: 'Raw bytes are never served through the API — downloads always go via a signed URL.',
  })
  @ApiResponse({ status: 200, description: 'Signed URL generated' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  getSignedUrl(
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Param('attId', ParseUUIDPipe) attId: string,
  ) {
    return this.attachmentsService.getSignedUrl(paymentId, attId);
  }

  @Delete(':attId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft delete an attachment (Manager only)',
    description: 'The stored object is retained — financial attachments are never removed from the bucket.',
  })
  @ApiResponse({ status: 200, description: 'Attachment soft deleted' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  remove(
    @Param('id', ParseUUIDPipe) paymentId: string,
    @Param('attId', ParseUUIDPipe) attId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachmentsService.remove(paymentId, attId, userId);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { PdfImportService, MAX_PDF_FILES_PER_BATCH } from './services/pdf-import.service';
import { CommitPdfImportDto } from './dtos/commit-pdf-import.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Import')
@ApiBearerAuth('access-token')
@Controller({ path: 'import/pdf', version: '1' })
export class PdfImportController {
  constructor(private readonly pdfImportService: PdfImportService) {}

  @Post('validate')
  @Roles(UserRole.MANAGER)
  @UseInterceptors(FilesInterceptor('files', MAX_PDF_FILES_PER_BATCH))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: `1-${MAX_PDF_FILES_PER_BATCH} DMT tenancy-contract PDFs`,
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Extract candidate rows from 1..N DMT contract PDFs (Manager only)',
    description:
      'Never writes business data. Extracts each PDF via the Anthropic API, resolves/dedupes buildings, ' +
      'properties, and tenants against the DB and within the batch, then creates PENDING_REVIEW ImportSession(s) ' +
      '(one per module) with per-row results. One bad PDF does not fail the whole batch.',
  })
  @ApiResponse({ status: 201, description: 'Batch extracted and sessions created' })
  @ApiResponse({ status: 400, description: 'No PDF could be extracted, or batch limits exceeded' })
  validate(@UploadedFiles() files: Express.Multer.File[], @CurrentUser('id') userId: string) {
    return this.pdfImportService.validate(files, userId);
  }

  @Get('sessions/:id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Fetch a PDF import batch (contract session id) for review' })
  @ApiResponse({ status: 200, description: 'Batch found' })
  @ApiResponse({ status: 404, description: 'Session not found or not a PDF batch' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pdfImportService.findOne(id);
  }

  @Post('commit')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Commit a validated PDF batch (Manager only)',
    description:
      'Creates the VALID candidate buildings/properties/tenants, then the VALID contracts, in dependency ' +
      'order, and attaches each contract\'s source PDF as a document where staging succeeded. One contract ' +
      'row failing does not undo the others.',
  })
  @ApiResponse({ status: 200, description: 'Batch committed (see contractFailures for any per-row issues)' })
  @ApiResponse({ status: 400, description: 'Session is not a PDF batch, or has no valid contract rows' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 409, description: 'Already committed, or a building/property/tenant row failed at commit time' })
  commit(@Body() dto: CommitPdfImportDto, @CurrentUser('id') userId: string) {
    return this.pdfImportService.commit(dto.contractSessionId, userId);
  }
}

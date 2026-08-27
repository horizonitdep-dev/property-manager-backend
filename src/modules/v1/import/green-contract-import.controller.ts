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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  GreenContractImportService,
  MAX_GREEN_FILES_PER_BATCH,
} from './services/green-contract-import.service';
import { GreenContractCommitDto } from './dtos/green-contract-commit.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * Green Contract ingestion — the landlord's own internal tenancy agreements.
 *
 * Entirely separate from the DMT path at /import/pdf/*: different endpoints,
 * different services, different session type. Nothing here touches DMT code, and
 * a session created by one importer is rejected by the other (§2, §9).
 *
 * MANAGER-only throughout: this writes business data.
 */
@ApiTags('Import / Green Contract')
@ApiBearerAuth('access-token')
@Controller({ path: 'import/green-contract', version: '1' })
export class GreenContractImportController {
  constructor(private readonly greenContractImportService: GreenContractImportService) {}

  @Post('validate')
  @Roles(UserRole.MANAGER)
  @UseInterceptors(FilesInterceptor('files', MAX_GREEN_FILES_PER_BATCH))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({
    summary: 'Extract Green Contract PDFs and build a preview (Manager only)',
    description:
      'Uploads 1–10 PDFs, extracts each with Haiku, resolves buildings/properties/tenants, applies the ' +
      'duplicate rule, and stores a PENDING_REVIEW session. Writes no business data. A PDF that cannot ' +
      'be extracted is reported in `failures` while the rest of the batch still processes.',
  })
  @ApiResponse({ status: 201, description: 'Preview created — review, then commit' })
  @ApiResponse({ status: 400, description: 'No files, too many files, a non-PDF, or one over 10 MB' })
  validate(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser('id') userId: string,
  ) {
    return this.greenContractImportService.validate(files, userId);
  }

  @Post('commit')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Commit a reviewed Green Contract batch (Manager only)',
    description:
      'Creates the VALID rows through each module’s real create path, stamps every contract with ' +
      'source = R6_GREEN_CONTRACT, and attaches the source PDF to each contract. Blocked rows are ' +
      'skipped. Committing twice is refused.',
  })
  @ApiResponse({ status: 200, description: 'Batch committed' })
  @ApiResponse({ status: 400, description: 'Not a Green Contract session, or nothing committable in it' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 409, description: 'Already committed, or a parent row failed mid-transaction' })
  commit(@Body() dto: GreenContractCommitDto, @CurrentUser('id') userId: string) {
    return this.greenContractImportService.commit(dto.sessionId, userId);
  }

  @Get('sessions/:id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Re-load a Green Contract preview (Manager only)',
    description: 'Rejects sessions belonging to any other importer.',
  })
  @ApiResponse({ status: 200, description: 'Session found' })
  @ApiResponse({ status: 400, description: 'Session belongs to a different importer' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.greenContractImportService.findOne(id);
  }
}

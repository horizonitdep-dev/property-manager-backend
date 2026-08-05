import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ImportSessionService } from './services/import-session.service';
import { TemplateService } from './services/template.service';
import { ParseImportModulePipe } from './pipes/parse-import-module.pipe';
import { IMPORT_MODULE_SLUGS } from './import-module-slug';
import { CommitImportDto } from './dtos/commit-import.dto';
import { ImportSessionResponseDto } from './dtos/validate-import.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ImportModule } from '../../../common/enums/import-module.enum';

@ApiTags('Import')
@ApiBearerAuth('access-token')
@ApiParam({ name: 'module', enum: IMPORT_MODULE_SLUGS, description: 'Which module to import into' })
@Controller({ path: 'import/:module', version: '1' })
export class ImportController {
  constructor(
    private readonly importSessionService: ImportSessionService,
    private readonly templateService: TemplateService,
  ) {}

  @Get('template')
  @Roles(UserRole.MANAGER)
  @ApiQuery({ name: 'format', enum: ['csv', 'xlsx'] })
  @ApiOperation({ summary: 'Download a CSV/XLSX import template with headers + one example row' })
  @ApiResponse({ status: 200, description: 'Template file stream' })
  @ApiResponse({ status: 400, description: 'Unknown module or format' })
  async getTemplate(
    @Param('module', ParseImportModulePipe) module: ImportModule,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException("format query param must be 'csv' or 'xlsx'");
    }

    const { buffer, filename, contentType } = await this.templateService.generate(module, format);

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Post('validate')
  @Roles(UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Dry-run validate a CSV/XLSX file (Manager only)',
    description: 'Never writes business data. Creates a PENDING_REVIEW ImportSession with per-row results.',
  })
  @ApiResponse({ status: 201, description: 'Session created', type: ImportSessionResponseDto })
  @ApiResponse({ status: 400, description: 'File too large/too many rows, or unparsable' })
  validate(
    @Param('module', ParseImportModulePipe) module: ImportModule,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    return this.importSessionService.validate(module, file, userId);
  }

  @Post('commit')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Commit the VALID rows of a validated session (Manager only)' })
  @ApiResponse({ status: 200, description: 'Rows inserted' })
  @ApiResponse({ status: 400, description: 'Module mismatch, or session has no valid rows' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 409, description: 'Session already committed, or a row failed at commit time' })
  commit(
    @Param('module', ParseImportModulePipe) module: ImportModule,
    @Body() dto: CommitImportDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.importSessionService.commit(dto.sessionId, module, userId);
  }
}

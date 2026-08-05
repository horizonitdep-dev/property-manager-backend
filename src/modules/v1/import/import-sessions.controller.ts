import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ImportSessionService } from './services/import-session.service';
import { ImportSessionResponseDto } from './dtos/validate-import.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Import')
@ApiBearerAuth('access-token')
@Controller({ path: 'import/sessions', version: '1' })
export class ImportSessionsController {
  constructor(private readonly importSessionService: ImportSessionService) {}

  @Get(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Fetch an import session (to re-load a preview)' })
  @ApiResponse({ status: 200, description: 'Session found', type: ImportSessionResponseDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.importSessionService.findOne(id);
  }
}

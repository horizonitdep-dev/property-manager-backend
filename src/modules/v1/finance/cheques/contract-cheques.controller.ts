import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChequesService } from './cheques.service';
import { ChequeResponseDto } from './dtos/cheque-response.dto';
import { ListChequesQueryDto } from './dtos/list-cheques.query.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../../common/decorators/api-paginated.decorator';

@ApiTags('Finance / Cheques')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/contracts/:contractId/cheques', version: '1' })
export class ContractChequesController {
  constructor(private readonly chequesService: ChequesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Cheque history for one contract' })
  @ApiPaginatedResponse(ChequeResponseDto)
  @ApiResponse({ status: 404, description: 'Contract not found' })
  findAllForContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Query() query: ListChequesQueryDto,
  ) {
    return this.chequesService.findAllByContract(contractId, query);
  }
}

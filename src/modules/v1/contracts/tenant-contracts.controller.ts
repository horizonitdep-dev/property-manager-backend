import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { ContractResponseDto } from './dtos/contract-response.dto';
import { ListContractsQueryDto } from './dtos/list-contracts.query.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated.decorator';

@ApiTags('Contracts')
@ApiBearerAuth('access-token')
@Controller({ path: 'tenants/:tenantId/contracts', version: '1' })
export class TenantContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Contract history for one tenant (renewals, multiple units over time)' })
  @ApiPaginatedResponse(ContractResponseDto)
  findAllForTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListContractsQueryDto,
  ) {
    return this.contractsService.findAllByTenant(tenantId, query);
  }
}

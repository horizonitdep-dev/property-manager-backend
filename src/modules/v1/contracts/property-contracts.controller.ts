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
@Controller({ path: 'properties/:propertyId/contracts', version: '1' })
export class PropertyContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Contract history for one property (tenancy-history mechanism)' })
  @ApiPaginatedResponse(ContractResponseDto)
  findAllForProperty(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() query: ListContractsQueryDto,
  ) {
    return this.contractsService.findAllByProperty(propertyId, query);
  }
}

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dtos/create-contract.dto';
import { UpdateContractDto } from './dtos/update-contract.dto';
import { RenewContractDto } from './dtos/renew-contract.dto';
import { TerminateContractDto } from './dtos/terminate-contract.dto';
import { ContractResponseDto } from './dtos/contract-response.dto';
import { ListContractsQueryDto } from './dtos/list-contracts.query.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated.decorator';

@ApiTags('Contracts')
@ApiBearerAuth('access-token')
@Controller({ path: 'contracts', version: '1' })
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'List contracts with pagination, search, filter and sort',
    description:
      'The returned status is the EFFECTIVE status, computed from the stored status + endDate. ' +
      'EXPIRING_SOON and EXPIRED are never stored directly but can still be filtered on.',
  })
  @ApiPaginatedResponse(ContractResponseDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListContractsQueryDto) {
    return this.contractsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get contract by ID, with nested tenant + property summaries' })
  @ApiResponse({ status: 200, description: 'Contract found', type: ContractResponseDto })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Create new contract (Manager only)' })
  @ApiResponse({ status: 201, description: 'Contract created', type: ContractResponseDto })
  @ApiResponse({ status: 404, description: 'Tenant or property not found' })
  @ApiResponse({ status: 400, description: 'endDate before startDate, or CHEQUES without numberOfCheques' })
  @ApiResponse({ status: 409, description: 'Overlapping active contract on this property' })
  create(@Body() dto: CreateContractDto, @CurrentUser('id') userId: string) {
    return this.contractsService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update contract (Manager only)' })
  @ApiResponse({ status: 200, description: 'Contract updated', type: ContractResponseDto })
  @ApiResponse({ status: 404, description: 'Contract, tenant, or property not found' })
  @ApiResponse({ status: 400, description: 'endDate before startDate, or CHEQUES without numberOfCheques' })
  @ApiResponse({ status: 409, description: 'Overlapping active contract on this property' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractsService.update(id, dto, userId);
  }

  @Post(':id/renew')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Renew a contract — creates a new linked record, source unchanged (Manager only)' })
  @ApiResponse({ status: 201, description: 'Renewal contract created', type: ContractResponseDto })
  @ApiResponse({ status: 404, description: 'Source contract not found' })
  @ApiResponse({ status: 409, description: 'Overlapping active contract on this property' })
  renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewContractDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractsService.renew(id, dto, userId);
  }

  @Post(':id/terminate')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Terminate a contract and free the property (Manager only)' })
  @ApiResponse({ status: 200, description: 'Contract terminated', type: ContractResponseDto })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateContractDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.contractsService.terminate(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete contract (Manager only)' })
  @ApiResponse({ status: 200, description: 'Contract soft deleted' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.contractsService.remove(id, userId);
  }
}

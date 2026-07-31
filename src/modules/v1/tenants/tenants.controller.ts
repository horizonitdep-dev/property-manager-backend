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
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dtos/create-tenant.dto';
import { UpdateTenantDto } from './dtos/update-tenant.dto';
import { TenantResponseDto } from './dtos/tenant-response.dto';
import { TenantListItemDto } from './dtos/tenant-list-item.dto';
import { ListTenantsQueryDto } from './dtos/list-tenants.query.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated.decorator';

@ApiTags('Tenants')
@ApiBearerAuth('access-token')
@Controller({ path: 'tenants', version: '1' })
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'List tenants with pagination, search, filter and sort (no ID numbers)',
  })
  @ApiPaginatedResponse(TenantListItemDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListTenantsQueryDto) {
    return this.tenantsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get tenant by ID, including ID numbers and documents' })
  @ApiResponse({ status: 200, description: 'Tenant found', type: TenantResponseDto })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Create new tenant (Manager only)' })
  @ApiResponse({ status: 201, description: 'Tenant created', type: TenantResponseDto })
  @ApiResponse({ status: 400, description: 'Missing required fields for the given tenantType' })
  create(@Body() dto: CreateTenantDto, @CurrentUser('id') userId: string) {
    return this.tenantsService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update tenant (Manager only)' })
  @ApiResponse({ status: 200, description: 'Tenant updated', type: TenantResponseDto })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  @ApiResponse({ status: 400, description: 'Missing required fields for the resulting tenantType' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.tenantsService.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete tenant (Manager only)' })
  @ApiResponse({ status: 200, description: 'Tenant soft deleted' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.tenantsService.remove(id, userId);
  }
}

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
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dtos/create-building.dto';
import { UpdateBuildingDto } from './dtos/update-building.dto';
import { BuildingResponseDto } from './dtos/building-response.dto';
import { ListBuildingsQueryDto } from './dtos/list-buildings.query.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated.decorator';

@ApiTags('Buildings')
@ApiBearerAuth('access-token')
@Controller({ path: 'buildings', version: '1' })
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'List buildings with pagination, search, filter and sort' })
  @ApiPaginatedResponse(BuildingResponseDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListBuildingsQueryDto) {
    return this.buildingsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get building by ID' })
  @ApiResponse({ status: 200, description: 'Building found', type: BuildingResponseDto })
  @ApiResponse({ status: 404, description: 'Building not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.buildingsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Create new building (Manager only)' })
  @ApiResponse({ status: 201, description: 'Building created', type: BuildingResponseDto })
  @ApiResponse({ status: 409, description: 'Duplicate building code' })
  create(@Body() dto: CreateBuildingDto, @CurrentUser('id') userId: string) {
    return this.buildingsService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update building (Manager only)' })
  @ApiResponse({ status: 200, description: 'Building updated', type: BuildingResponseDto })
  @ApiResponse({ status: 404, description: 'Building not found' })
  @ApiResponse({ status: 409, description: 'Duplicate building code' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuildingDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.buildingsService.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete building (Manager only)' })
  @ApiResponse({ status: 200, description: 'Building soft deleted' })
  @ApiResponse({ status: 404, description: 'Building not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.buildingsService.remove(id, userId);
  }
}

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
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dtos/create-property.dto';
import { UpdatePropertyDto } from './dtos/update-property.dto';
import { PropertyResponseDto } from './dtos/property-response.dto';
import { ListPropertiesQueryDto } from './dtos/list-properties.query.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated.decorator';

@ApiTags('Properties')
@ApiBearerAuth('access-token')
@Controller({ path: 'properties', version: '1' })
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'List properties with pagination, search, filter and sort' })
  @ApiPaginatedResponse(PropertyResponseDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListPropertiesQueryDto) {
    return this.propertiesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get property by ID' })
  @ApiResponse({ status: 200, description: 'Property found', type: PropertyResponseDto })
  @ApiResponse({ status: 404, description: 'Property not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.propertiesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Create new property (Manager only)' })
  @ApiResponse({ status: 201, description: 'Property created', type: PropertyResponseDto })
  @ApiResponse({ status: 404, description: 'Building not found' })
  @ApiResponse({ status: 409, description: 'Duplicate unit number in building' })
  create(@Body() dto: CreatePropertyDto, @CurrentUser('id') userId: string) {
    return this.propertiesService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({ summary: 'Update property (Manager only)' })
  @ApiResponse({ status: 200, description: 'Property updated', type: PropertyResponseDto })
  @ApiResponse({ status: 404, description: 'Property not found' })
  @ApiResponse({ status: 409, description: 'Duplicate unit number in building' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.propertiesService.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete property (Manager only)' })
  @ApiResponse({ status: 200, description: 'Property soft deleted' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.propertiesService.remove(id, userId);
  }
}

import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { PropertyResponseDto } from './dtos/property-response.dto';
import { ListPropertiesQueryDto } from './dtos/list-properties.query.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated.decorator';

@ApiTags('Properties')
@ApiBearerAuth('access-token')
@Controller({ path: 'buildings/:buildingId/properties', version: '1' })
export class BuildingPropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'List all properties belonging to one building' })
  @ApiPaginatedResponse(PropertyResponseDto)
  findAllForBuilding(
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @Query() query: ListPropertiesQueryDto,
  ) {
    return this.propertiesService.findAllByBuilding(buildingId, query);
  }
}

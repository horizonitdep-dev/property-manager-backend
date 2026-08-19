import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { ExpenseResponseDto } from './dtos/expense-response.dto';
import { ListExpensesQueryDto } from './dtos/list-expenses.query.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../../common/decorators/api-paginated.decorator';

/** Kept under finance/ so Buildings and Properties stay unaware of Finance (spec §2). */
@ApiTags('Finance / Expenses')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/buildings/:buildingId/expenses', version: '1' })
export class BuildingExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Expenses for one building',
    description: 'Includes unit-level expenses within the building, not just building-wide ones.',
  })
  @ApiPaginatedResponse(ExpenseResponseDto)
  @ApiResponse({ status: 404, description: 'Building not found' })
  findAllForBuilding(
    @Param('buildingId', ParseUUIDPipe) buildingId: string,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expensesService.findAllByBuilding(buildingId, query);
  }
}

@ApiTags('Finance / Expenses')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/properties/:propertyId/expenses', version: '1' })
export class PropertyExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Expenses attributed to one unit' })
  @ApiPaginatedResponse(ExpenseResponseDto)
  @ApiResponse({ status: 404, description: 'Property not found' })
  findAllForProperty(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expensesService.findAllByProperty(propertyId, query);
  }
}

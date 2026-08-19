import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dtos/create-expense.dto';
import { UpdateExpenseDto } from './dtos/update-expense.dto';
import { ListExpensesQueryDto } from './dtos/list-expenses.query.dto';
import { ExpenseResponseDto } from './dtos/expense-response.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../../common/decorators/api-paginated.decorator';

@ApiTags('Finance / Expenses')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/expenses', version: '1' })
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'List expenses with pagination, filters and sort' })
  @ApiPaginatedResponse(ExpenseResponseDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListExpensesQueryDto) {
    return this.expensesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get expense by ID, incl. building, property and attachments' })
  @ApiResponse({ status: 200, description: 'Expense found', type: ExpenseResponseDto })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Record an expense (Manager only)',
    description:
      'Defaults to sourceType GENERAL. A building is always required; a unit is optional but must belong ' +
      'to that building.',
  })
  @ApiResponse({ status: 201, description: 'Expense created', type: ExpenseResponseDto })
  @ApiResponse({ status: 400, description: 'Unit is not in that building, or source fields are incoherent' })
  @ApiResponse({ status: 404, description: 'Building or property not found' })
  create(@Body() dto: CreateExpenseDto, @CurrentUser('id') userId: string) {
    return this.expensesService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update an expense (Manager only)',
    description:
      'Only GENERAL expenses are editable here. Ones originated by another module must be changed through ' +
      'that module.',
  })
  @ApiResponse({ status: 200, description: 'Expense updated', type: ExpenseResponseDto })
  @ApiResponse({ status: 400, description: 'Unit is not in that building' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  @ApiResponse({ status: 409, description: 'Expense is owned by another module' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.expensesService.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft delete an expense (Manager only)',
    description: 'Excluded from lists and reports afterwards, but retained for audit.',
  })
  @ApiResponse({ status: 200, description: 'Expense soft deleted' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.expensesService.remove(id, userId);
  }
}

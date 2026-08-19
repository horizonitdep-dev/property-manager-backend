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
import { ChequesService } from './cheques.service';
import { CreateChequeDto } from './dtos/create-cheque.dto';
import { UpdateChequeDto } from './dtos/update-cheque.dto';
import { ListChequesQueryDto } from './dtos/list-cheques.query.dto';
import { ChequeResponseDto } from './dtos/cheque-response.dto';
import {
  BounceChequeDto,
  CancelChequeDto,
  ClearChequeDto,
  DepositChequeDto,
  ReplaceChequeDto,
} from './dtos/cheque-actions.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../../common/decorators/api-paginated.decorator';

@ApiTags('Finance / Cheques')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/cheques', version: '1' })
export class ChequesController {
  constructor(private readonly chequesService: ChequesService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'List cheques with pagination, filters and sort' })
  @ApiPaginatedResponse(ChequeResponseDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListChequesQueryDto) {
    return this.chequesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Get cheque by ID',
    description:
      'Includes the contract, the linked payment (only while cleared and not voided), both ends of the ' +
      'replacement chain, and attachments.',
  })
  @ApiResponse({ status: 200, description: 'Cheque found', type: ChequeResponseDto })
  @ApiResponse({ status: 404, description: 'Cheque not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.chequesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Record a received cheque (Manager only)',
    description: 'Always starts HELD. Status moves only through the lifecycle endpoints below.',
  })
  @ApiResponse({ status: 201, description: 'Cheque created', type: ChequeResponseDto })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 409, description: 'That cheque number already exists for this bank' })
  create(@Body() dto: CreateChequeDto, @CurrentUser('id') userId: string) {
    return this.chequesService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Edit cheque metadata (Manager only)',
    description: 'Allowed only while HELD — once banked, the record must match what the bank saw.',
  })
  @ApiResponse({ status: 200, description: 'Cheque updated', type: ChequeResponseDto })
  @ApiResponse({ status: 404, description: 'Cheque not found' })
  @ApiResponse({ status: 409, description: 'Cheque is past HELD, or the number clashes within the bank' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChequeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chequesService.update(id, dto, userId);
  }

  @Post(':id/deposit')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HELD → DEPOSITED (Manager only)' })
  @ApiResponse({ status: 200, description: 'Cheque deposited', type: ChequeResponseDto })
  @ApiResponse({ status: 409, description: 'Cheque is not HELD' })
  deposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepositChequeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chequesService.deposit(id, dto, userId);
  }

  @Post(':id/clear')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'DEPOSITED → CLEARED, creating the linked Payment (Manager only)',
    description:
      'The Payment is created in the same transaction with amount and date taken from the cheque. ' +
      'This is the only way a cheque produces a Payment.',
  })
  @ApiResponse({ status: 200, description: 'Cheque cleared and payment recorded', type: ChequeResponseDto })
  @ApiResponse({ status: 409, description: 'Cheque is not DEPOSITED' })
  clear(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClearChequeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chequesService.clear(id, dto, userId);
  }

  @Post(':id/bounce')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'DEPOSITED or CLEARED → BOUNCED (Manager only)',
    description:
      'Bouncing a cleared cheque voids its Payment in the same transaction, so bounced money is never ' +
      'counted as received.',
  })
  @ApiResponse({ status: 200, description: 'Cheque bounced', type: ChequeResponseDto })
  @ApiResponse({ status: 409, description: 'Cheque cannot bounce from its current status' })
  bounce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BounceChequeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chequesService.bounce(id, dto, userId);
  }

  @Post(':id/replace')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Replace a bounced or held cheque (Manager only)',
    description:
      'Creates the replacement and marks the original REPLACED in one transaction. The replacement ' +
      'inherits the original contract and starts HELD. Returns the NEW cheque.',
  })
  @ApiResponse({ status: 201, description: 'Replacement created', type: ChequeResponseDto })
  @ApiResponse({ status: 409, description: 'Cheque cannot be replaced, or has already been replaced' })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceChequeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chequesService.replace(id, dto, userId);
  }

  @Post(':id/cancel')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HELD → CANCELLED, voided before deposit (Manager only)' })
  @ApiResponse({ status: 200, description: 'Cheque cancelled', type: ChequeResponseDto })
  @ApiResponse({ status: 409, description: 'Cheque is not HELD' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelChequeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chequesService.cancel(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft delete a cheque (Manager only)',
    description: 'Only HELD or CANCELLED — a cheque with financial history downstream is never removed.',
  })
  @ApiResponse({ status: 200, description: 'Cheque soft deleted' })
  @ApiResponse({ status: 409, description: 'Cheque has progressed beyond HELD/CANCELLED' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.chequesService.remove(id, userId);
  }
}

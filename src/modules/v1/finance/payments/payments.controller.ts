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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dtos/create-payment.dto';
import { UpdatePaymentDto } from './dtos/update-payment.dto';
import { ListPaymentsQueryDto } from './dtos/list-payments.query.dto';
import { PaymentResponseDto } from './dtos/payment-response.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../../common/decorators/api-paginated.decorator';

@ApiTags('Finance / Payments')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/payments', version: '1' })
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'List payments with pagination, filters and sort',
    description:
      'Amounts are returned as strings to preserve Decimal(12,2) precision. Tenant/property/building ' +
      'filters resolve through the contract — Finance does not denormalise them.',
  })
  @ApiPaginatedResponse(PaymentResponseDto)
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Get payment by ID, incl. contract, cheque and attachments' })
  @ApiResponse({ status: 200, description: 'Payment found', type: PaymentResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Record a manual payment (Manager only)',
    description:
      'For money received outside the cheque flow. A payment linked to a cheque is never created ' +
      'here — it is produced only by POST /finance/cheques/:id/clear.',
  })
  @ApiResponse({ status: 201, description: 'Payment created', type: PaymentResponseDto })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  create(@Body() dto: CreatePaymentDto, @CurrentUser('id') userId: string) {
    return this.paymentsService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  @ApiOperation({
    summary: 'Update a payment (Manager only)',
    description:
      'Cheque-linked payments accept metadata changes only — amount and paidOn are owned by the cheque.',
  })
  @ApiResponse({ status: 200, description: 'Payment updated', type: PaymentResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({ status: 409, description: 'Attempted to change an amount/date owned by the linked cheque' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.paymentsService.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft delete a payment (Manager only)',
    description: 'Excluded from lists and all reports afterwards, but retained for audit.',
  })
  @ApiResponse({ status: 200, description: 'Payment soft deleted' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.paymentsService.remove(id, userId);
  }
}

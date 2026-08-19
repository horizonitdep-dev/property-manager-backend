import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { PaymentResponseDto } from './dtos/payment-response.dto';
import { ListPaymentsQueryDto } from './dtos/list-payments.query.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ApiPaginatedResponse } from '../../../../common/decorators/api-paginated.decorator';

/**
 * Nested under finance/ rather than at /contracts/:id/payments so the whole
 * module stays behind one prefix (spec §7) and Finance never adds routes to the
 * Contracts controller — the dependency direction only points one way.
 */
@ApiTags('Finance / Payments')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/contracts/:contractId/payments', version: '1' })
export class ContractPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({ summary: 'Payment history for one contract' })
  @ApiPaginatedResponse(PaymentResponseDto)
  @ApiResponse({ status: 404, description: 'Contract not found' })
  findAllForContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Query() query: ListPaymentsQueryDto,
  ) {
    return this.paymentsService.findAllByContract(contractId, query);
  }
}

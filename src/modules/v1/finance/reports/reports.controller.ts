import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import {
  AnnualTenantCountQueryDto,
  OutstandingReportQueryDto,
  PnlReportQueryDto,
  RentRollReportQueryDto,
  UpcomingChequesQueryDto,
} from './dtos/report-query.dto';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';

/** All read-only, and readable by both roles (spec §7). */
@ApiTags('Finance / Reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'finance/reports', version: '1' })
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('outstanding')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Receivables per active contract',
    description:
      'Rent falls due in INSTALLMENTS, not day by day: a tenant paying 40,000 across four cheques owes ' +
      '10,000 on each quarter date and nothing in between. Each row carries nextDueOn/nextDueAmount so ' +
      'the owner can be reminded before the next installment lands. Amounts are strings.',
  })
  @ApiResponse({ status: 200, description: 'Outstanding balances with a per-contract breakdown' })
  outstanding(@Query() query: OutstandingReportQueryDto) {
    return this.reportsService.outstanding(query);
  }

  @Get('pnl')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Profit and loss over a date range',
    description:
      'Revenue is money actually received, not billed. REFUND payments are subtracted rather than added. ' +
      'Groupable by building, property, month, quarter or year.',
  })
  @ApiResponse({ status: 200, description: 'P&L buckets with per-category expense breakdown' })
  @ApiResponse({ status: 400, description: 'toDate is before fromDate' })
  pnl(@Query() query: PnlReportQueryDto) {
    return this.reportsService.pnl(query);
  }

  @Get('rent-roll')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Rent position per active contract',
    description:
      'The outstanding view plus the next cheque physically on file, so expected money and held money can ' +
      'be compared side by side.',
  })
  @ApiResponse({ status: 200, description: 'Rent roll rows' })
  rentRoll(@Query() query: RentRollReportQueryDto) {
    return this.reportsService.rentRoll(query);
  }

  @Get('cheques-upcoming')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Cheques due within N days',
    description:
      'HELD or DEPOSITED cheques dated within the window. Cheques already past their date are included and ' +
      'flagged isOverdue — an unbanked cheque from last month is more urgent, not less.',
  })
  @ApiResponse({ status: 200, description: 'Upcoming cheques, soonest first' })
  upcomingCheques(@Query() query: UpcomingChequesQueryDto) {
    return this.reportsService.upcomingCheques(query);
  }

  @Get('annual-tenant-count')
  @Roles(UserRole.MANAGER, UserRole.SECRETARY)
  @ApiOperation({
    summary: 'Unique tenants taken on per calendar year',
    description:
      'Counts distinct tenants whose contract STARTED in each year. A tenant signing twice in one year ' +
      'counts once; signing again in a later year counts again. Empty years are included.',
  })
  @ApiResponse({ status: 200, description: '{ year, tenantCount, contractCount }[]' })
  @ApiResponse({ status: 400, description: 'toYear is before fromYear' })
  annualTenantCount(@Query() query: AnnualTenantCountQueryDto) {
    return this.reportsService.annualTenantCount(query);
  }
}

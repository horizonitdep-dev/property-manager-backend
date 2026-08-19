import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { ChequeStatus } from '../../../../common/enums/cheque-status.enum';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { PaymentFrequency } from '../../../../common/enums/payment-frequency.enum';
import { PaymentKind } from '../../../../common/enums/payment-kind.enum';
import { sumMoney, toMoneyString } from '../shared/finance-money.util';
import { daysBetween, toIsoDate, toUtcDay, utcYear } from './helpers/date-range.helper';
import { calculateOutstanding } from './helpers/outstanding.helper';
import { PnlExpenseRow, PnlPaymentRow, buildPnlBuckets } from './helpers/pnl.helper';
import {
  AnnualTenantCountQueryDto,
  OutstandingReportQueryDto,
  PnlReportQueryDto,
  RentRollReportQueryDto,
  UpcomingChequesQueryDto,
} from './dtos/report-query.dto';

const contractForReport = {
  id: true,
  contractNumber: true,
  startDate: true,
  endDate: true,
  annualRent: true,
  monthlyRent: true,
  paymentFrequency: true,
  numberOfCheques: true,
  status: true,
  tenant: { select: { id: true, nameEn: true, tenantType: true } },
  property: {
    select: {
      id: true,
      unitNumber: true,
      building: { select: { id: true, name: true, code: true } },
    },
  },
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Receivables per contract, using the installment schedule rather than daily
   * accrual — see outstanding.helper for the rule and why it differs from §7.
   *
   * Only ACTIVE contracts are reported: a draft has not started and a terminated
   * one is settled separately.
   */
  async outstanding(query: OutstandingReportQueryDto) {
    const asOfDate = query.asOfDate ? toUtcDay(new Date(query.asOfDate)) : toUtcDay(new Date());

    const contracts = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        status: ContractStatus.ACTIVE,
        startDate: { lte: asOfDate },
        ...(query.tenantId && { tenantId: query.tenantId }),
        ...(query.propertyId && { propertyId: query.propertyId }),
        ...(query.buildingId && { property: { buildingId: query.buildingId } }),
      },
      select: contractForReport,
    });

    // One grouped query rather than one per contract — the arrears screen loads
    // every active contract at once.
    const received = await this.prisma.payment.groupBy({
      by: ['contractId'],
      where: {
        deletedAt: null,
        kind: PaymentKind.RENT,
        paidOn: { lte: asOfDate },
        contractId: { in: contracts.map((c) => c.id) },
      },
      _sum: { amount: true },
    });

    const receivedByContract = new Map(
      received.map((row) => [row.contractId, row._sum.amount ?? new Prisma.Decimal(0)]),
    );

    const rows = contracts.map((contract) => {
      const breakdown = calculateOutstanding(
        {
          startDate: contract.startDate,
          endDate: contract.endDate,
          annualRent: contract.annualRent,
          paymentFrequency: contract.paymentFrequency as unknown as PaymentFrequency,
          numberOfCheques: contract.numberOfCheques,
        },
        [receivedByContract.get(contract.id) ?? new Prisma.Decimal(0)],
        asOfDate,
      );

      return {
        contract: this.contractSummary(contract),
        expectedToDate: toMoneyString(breakdown.expectedToDate),
        receivedToDate: toMoneyString(breakdown.receivedToDate),
        outstanding: toMoneyString(breakdown.outstanding),
        credit: toMoneyString(breakdown.credit),
        installmentsDue: breakdown.installmentsDue,
        installmentsTotal: breakdown.installmentsTotal,
        nextDueOn: breakdown.nextDue ? toIsoDate(breakdown.nextDue.dueOn) : null,
        nextDueAmount: breakdown.nextDue ? toMoneyString(breakdown.nextDue.amount) : null,
        daysUntilNextDue: breakdown.daysUntilNextDue,
        isOverdue: breakdown.isOverdue,
      };
    });

    const visible = query.overdueOnly === 'true' ? rows.filter((row) => row.isOverdue) : rows;

    return {
      asOfDate: toIsoDate(asOfDate),
      summary: {
        contracts: visible.length,
        overdueContracts: visible.filter((row) => row.isOverdue).length,
        totalExpected: toMoneyString(sumMoney(visible.map((r) => r.expectedToDate ?? '0'))),
        totalReceived: toMoneyString(sumMoney(visible.map((r) => r.receivedToDate ?? '0'))),
        totalOutstanding: toMoneyString(sumMoney(visible.map((r) => r.outstanding ?? '0'))),
        totalCredit: toMoneyString(sumMoney(visible.map((r) => r.credit ?? '0'))),
      },
      rows: visible,
    };
  }

  /** Revenue received minus expenses incurred in the window, bucketed. */
  async pnl(query: PnlReportQueryDto) {
    const fromDate = toUtcDay(new Date(query.fromDate));
    const toDate = toUtcDay(new Date(query.toDate));

    if (toDate < fromDate) {
      throw new BadRequestException('toDate must be on or after fromDate');
    }

    const grouping = query.groupBy ?? 'month';

    const [payments, expenses] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          deletedAt: null,
          paidOn: { gte: fromDate, lte: toDate },
          contract: {
            deletedAt: null,
            ...(query.tenantId && { tenantId: query.tenantId }),
            ...(query.propertyId && { propertyId: query.propertyId }),
            ...(query.buildingId && { property: { buildingId: query.buildingId } }),
          },
        },
        select: {
          amount: true,
          kind: true,
          paidOn: true,
          contract: {
            select: {
              property: {
                select: { id: true, unitNumber: true, building: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          deletedAt: null,
          incurredOn: { gte: fromDate, lte: toDate },
          ...(query.buildingId && { buildingId: query.buildingId }),
          ...(query.propertyId && { propertyId: query.propertyId }),
          // An expense has no tenant, so a tenant-scoped P&L reports revenue only.
          ...(query.tenantId && { id: '00000000-0000-0000-0000-000000000000' }),
        },
        select: {
          amount: true,
          category: true,
          incurredOn: true,
          buildingId: true,
          building: { select: { name: true } },
          propertyId: true,
          property: { select: { unitNumber: true } },
        },
      }),
    ]);

    const paymentRows: PnlPaymentRow[] = payments.map((payment) => ({
      amount: payment.amount,
      kind: payment.kind as unknown as PaymentKind,
      paidOn: payment.paidOn,
      buildingId: payment.contract.property.building.id,
      buildingLabel: payment.contract.property.building.name,
      propertyId: payment.contract.property.id,
      propertyLabel: payment.contract.property.unitNumber,
    }));

    const expenseRows: PnlExpenseRow[] = expenses.map((expense) => ({
      amount: expense.amount,
      category: expense.category as unknown as PnlExpenseRow['category'],
      incurredOn: expense.incurredOn,
      buildingId: expense.buildingId,
      buildingLabel: expense.building.name,
      propertyId: expense.propertyId,
      propertyLabel: expense.property?.unitNumber ?? null,
    }));

    const buckets = buildPnlBuckets(paymentRows, expenseRows, grouping);

    return {
      fromDate: toIsoDate(fromDate),
      toDate: toIsoDate(toDate),
      groupBy: grouping,
      totals: {
        revenue: toMoneyString(sumMoney(buckets.map((b) => b.revenue))),
        refunds: toMoneyString(sumMoney(buckets.map((b) => b.refunds))),
        expenses: toMoneyString(sumMoney(buckets.map((b) => b.expenses))),
        net: toMoneyString(sumMoney(buckets.map((b) => b.net))),
      },
      buckets: buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        revenue: toMoneyString(bucket.revenue),
        refunds: toMoneyString(bucket.refunds),
        expenses: toMoneyString(bucket.expenses),
        net: toMoneyString(bucket.net),
        expensesByCategory: bucket.expensesByCategory.map((row) => ({
          category: row.category,
          amount: toMoneyString(row.amount),
        })),
      })),
    };
  }

  /** Per-contract rent position, including the next cheque actually on file. */
  async rentRoll(query: RentRollReportQueryDto) {
    const asOfDate = query.asOfDate ? toUtcDay(new Date(query.asOfDate)) : toUtcDay(new Date());
    const outstanding = await this.outstanding({ ...query, asOfDate: toIsoDate(asOfDate) });

    const contractIds = outstanding.rows.map((row) => row.contract.id);

    // Earliest not-yet-banked cheque per contract, so the row can show what is
    // physically in hand as well as what the schedule says is due.
    const cheques = await this.prisma.cheque.findMany({
      where: {
        deletedAt: null,
        contractId: { in: contractIds },
        status: { in: [ChequeStatus.HELD, ChequeStatus.DEPOSITED] },
        chequeDate: { gte: asOfDate },
      },
      orderBy: { chequeDate: 'asc' },
      select: { id: true, contractId: true, chequeNumber: true, bankName: true, amount: true, chequeDate: true, status: true },
    });

    const nextChequeByContract = new Map<string, (typeof cheques)[number]>();
    for (const cheque of cheques) {
      if (!nextChequeByContract.has(cheque.contractId)) {
        nextChequeByContract.set(cheque.contractId, cheque);
      }
    }

    return {
      asOfDate: outstanding.asOfDate,
      summary: outstanding.summary,
      rows: outstanding.rows.map((row) => {
        const cheque = nextChequeByContract.get(row.contract.id);

        return {
          ...row,
          annualRent: row.contract.annualRent,
          monthlyRent: row.contract.monthlyRent,
          nextCheque: cheque
            ? {
                id: cheque.id,
                chequeNumber: cheque.chequeNumber,
                bankName: cheque.bankName,
                amount: toMoneyString(cheque.amount),
                chequeDate: toIsoDate(cheque.chequeDate),
                status: cheque.status,
              }
            : null,
        };
      }),
    };
  }

  /** Cheques coming due — the "cheques due soon" widget. */
  async upcomingCheques(query: UpcomingChequesQueryDto) {
    const today = toUtcDay(new Date());
    const withinDays = query.withinDays ?? 30;
    const until = new Date(today);
    until.setUTCDate(until.getUTCDate() + withinDays);

    const cheques = await this.prisma.cheque.findMany({
      where: {
        deletedAt: null,
        status: { in: [ChequeStatus.HELD, ChequeStatus.DEPOSITED] },
        // Open-ended at the start: a cheque whose date has passed but which was
        // never banked is more urgent than one due next week, not less.
        chequeDate: { lte: until },
        contract: {
          deletedAt: null,
          ...(query.tenantId && { tenantId: query.tenantId }),
          ...(query.propertyId && { propertyId: query.propertyId }),
          ...(query.buildingId && { property: { buildingId: query.buildingId } }),
        },
      },
      orderBy: { chequeDate: 'asc' },
      select: {
        id: true,
        chequeNumber: true,
        bankName: true,
        amount: true,
        chequeDate: true,
        status: true,
        contract: { select: contractForReport },
      },
    });

    const rows = cheques.map((cheque) => ({
      id: cheque.id,
      chequeNumber: cheque.chequeNumber,
      bankName: cheque.bankName,
      amount: toMoneyString(cheque.amount),
      chequeDate: toIsoDate(cheque.chequeDate),
      status: cheque.status,
      daysUntilDue: daysBetween(today, cheque.chequeDate),
      isOverdue: cheque.chequeDate < today,
      contract: this.contractSummary(cheque.contract),
    }));

    return {
      asOfDate: toIsoDate(today),
      withinDays,
      summary: {
        cheques: rows.length,
        overdue: rows.filter((row) => row.isOverdue).length,
        totalAmount: toMoneyString(sumMoney(rows.map((row) => row.amount ?? '0'))),
      },
      rows,
    };
  }

  /**
   * Unique tenants whose contract STARTED in each calendar year.
   *
   * A tenant with two contracts starting in the same year counts once for that
   * year, but is counted again in a later year if they signed again then — the
   * question is "how many tenants did we take on that year", not "how many
   * distinct tenants ever".
   */
  async annualTenantCount(query: AnnualTenantCountQueryDto) {
    if (query.toYear < query.fromYear) {
      throw new BadRequestException('toYear must be on or after fromYear');
    }

    const contracts = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        startDate: {
          gte: new Date(Date.UTC(query.fromYear, 0, 1)),
          lte: new Date(Date.UTC(query.toYear, 11, 31)),
        },
        ...(query.buildingId && { property: { buildingId: query.buildingId } }),
        ...(query.tenantType && { tenant: { tenantType: query.tenantType } }),
      },
      select: { startDate: true, tenantId: true },
    });

    const tenantsByYear = new Map<number, Set<string>>();
    const contractsByYear = new Map<number, number>();

    for (const contract of contracts) {
      const year = utcYear(contract.startDate);
      if (!tenantsByYear.has(year)) tenantsByYear.set(year, new Set());
      tenantsByYear.get(year)!.add(contract.tenantId);
      contractsByYear.set(year, (contractsByYear.get(year) ?? 0) + 1);
    }

    const rows = [];
    // Every year in the range appears, including empty ones, so a chart does not
    // silently close the gap over a year with no lettings.
    for (let year = query.fromYear; year <= query.toYear; year++) {
      rows.push({
        year,
        tenantCount: tenantsByYear.get(year)?.size ?? 0,
        contractCount: contractsByYear.get(year) ?? 0,
      });
    }

    return rows;
  }

  private contractSummary(contract: {
    id: string;
    contractNumber: string;
    startDate: Date;
    endDate: Date;
    annualRent: Prisma.Decimal;
    monthlyRent: Prisma.Decimal;
    paymentFrequency: unknown;
    tenant: { id: string; nameEn: string; tenantType: unknown };
    property: { id: string; unitNumber: string; building: { id: string; name: string; code: string } };
  }) {
    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      startDate: toIsoDate(contract.startDate),
      endDate: toIsoDate(contract.endDate),
      annualRent: toMoneyString(contract.annualRent),
      monthlyRent: toMoneyString(contract.monthlyRent),
      paymentFrequency: contract.paymentFrequency,
      tenant: contract.tenant,
      property: contract.property,
    };
  }
}

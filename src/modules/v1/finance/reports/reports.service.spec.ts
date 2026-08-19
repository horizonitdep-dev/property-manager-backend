import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../../../database/prisma.service';
import { ChequeStatus } from '../../../../common/enums/cheque-status.enum';
import { ContractStatus } from '../../../../common/enums/contract-status.enum';
import { ExpenseCategory } from '../../../../common/enums/expense-category.enum';
import { PaymentFrequency } from '../../../../common/enums/payment-frequency.enum';
import { PaymentKind } from '../../../../common/enums/payment-kind.enum';

const money = (v: string | number) => new Prisma.Decimal(v);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** 40,000/year, four quarterly installments — the client's worked example. */
const contract = {
  id: 'contract-uuid',
  contractNumber: '202303980216',
  startDate: d('2026-01-01'),
  endDate: d('2026-12-31'),
  annualRent: money(40000),
  monthlyRent: money('3333.33'),
  paymentFrequency: PaymentFrequency.QUARTERLY,
  numberOfCheques: 4,
  status: ContractStatus.ACTIVE,
  tenant: { id: 'tenant-uuid', nameEn: 'Ahmed Al Mansoori', tenantType: 'INDIVIDUAL' },
  property: {
    id: 'property-uuid',
    unitNumber: '102',
    building: { id: 'building-uuid', name: 'R6-MZW16', code: 'R6-MZW16' },
  },
};

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: {
    contract: { findMany: jest.Mock };
    payment: { groupBy: jest.Mock; findMany: jest.Mock };
    expense: { findMany: jest.Mock };
    cheque: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      contract: { findMany: jest.fn().mockResolvedValue([contract]) },
      payment: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      cheque: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('outstanding', () => {
    it('reports nothing owed mid-quarter once the installment is paid', async () => {
      prisma.payment.groupBy.mockResolvedValue([
        { contractId: 'contract-uuid', _sum: { amount: money(10000) } },
      ]);

      const report = await service.outstanding({ asOfDate: '2026-02-15' });

      expect(report.rows[0].outstanding).toBe('0.00');
      expect(report.rows[0].isOverdue).toBe(false);
    });

    it('reports the next quarter owing once April arrives', async () => {
      prisma.payment.groupBy.mockResolvedValue([
        { contractId: 'contract-uuid', _sum: { amount: money(10000) } },
      ]);

      const report = await service.outstanding({ asOfDate: '2026-04-01' });

      expect(report.rows[0].expectedToDate).toBe('20000.00');
      expect(report.rows[0].outstanding).toBe('10000.00');
      expect(report.rows[0].isOverdue).toBe(true);
    });

    it('carries the next due date and amount for reminders', async () => {
      const report = await service.outstanding({ asOfDate: '2026-02-15' });

      expect(report.rows[0].nextDueOn).toBe('2026-04-01');
      expect(report.rows[0].nextDueAmount).toBe('10000.00');
      expect(report.rows[0].daysUntilNextDue).toBe(45);
    });

    it('only counts RENT payments received on or before the as-of date', async () => {
      await service.outstanding({ asOfDate: '2026-04-01' });

      const { where } = prisma.payment.groupBy.mock.calls[0][0];
      expect(where.kind).toBe(PaymentKind.RENT);
      expect(where.deletedAt).toBeNull();
      expect(where.paidOn).toEqual({ lte: d('2026-04-01') });
    });

    it('excludes draft and terminated contracts', async () => {
      await service.outstanding({});

      expect(prisma.contract.findMany.mock.calls[0][0].where.status).toBe(ContractStatus.ACTIVE);
    });

    it('excludes contracts that have not started yet', async () => {
      await service.outstanding({ asOfDate: '2026-04-01' });

      expect(prisma.contract.findMany.mock.calls[0][0].where.startDate).toEqual({ lte: d('2026-04-01') });
    });

    it('totals across contracts', async () => {
      const report = await service.outstanding({ asOfDate: '2026-04-01' });

      expect(report.summary.totalExpected).toBe('20000.00');
      expect(report.summary.totalOutstanding).toBe('20000.00');
      expect(report.summary.overdueContracts).toBe(1);
    });

    it('can narrow to only contracts in arrears', async () => {
      prisma.payment.groupBy.mockResolvedValue([
        { contractId: 'contract-uuid', _sum: { amount: money(40000) } },
      ]);

      const report = await service.outstanding({ asOfDate: '2026-04-01', overdueOnly: 'true' });

      expect(report.rows).toHaveLength(0);
    });

    it('resolves a building filter through the property', async () => {
      await service.outstanding({ buildingId: 'building-uuid' });

      expect(prisma.contract.findMany.mock.calls[0][0].where.property).toEqual({
        buildingId: 'building-uuid',
      });
    });
  });

  describe('pnl', () => {
    const payment = {
      amount: money(10000),
      kind: PaymentKind.RENT,
      paidOn: d('2026-01-05'),
      contract: {
        property: { id: 'property-uuid', unitNumber: '102', building: { id: 'building-uuid', name: 'R6-MZW16' } },
      },
    };
    const expense = {
      amount: money(1500),
      category: ExpenseCategory.MAINTENANCE,
      incurredOn: d('2026-01-20'),
      buildingId: 'building-uuid',
      building: { name: 'R6-MZW16' },
      propertyId: null,
      property: null,
    };

    it('nets revenue against expenses', async () => {
      prisma.payment.findMany.mockResolvedValue([payment]);
      prisma.expense.findMany.mockResolvedValue([expense]);

      const report = await service.pnl({ fromDate: '2026-01-01', toDate: '2026-12-31' });

      expect(report.totals.revenue).toBe('10000.00');
      expect(report.totals.expenses).toBe('1500.00');
      expect(report.totals.net).toBe('8500.00');
    });

    it('subtracts refunds rather than adding them', async () => {
      // A refund is stored positive but is money going out — adding it would
      // overstate revenue by twice the refund.
      prisma.payment.findMany.mockResolvedValue([
        payment,
        { ...payment, amount: money(2000), kind: PaymentKind.REFUND },
      ]);

      const report = await service.pnl({ fromDate: '2026-01-01', toDate: '2026-12-31' });

      expect(report.totals.revenue).toBe('10000.00');
      expect(report.totals.refunds).toBe('2000.00');
      expect(report.totals.net).toBe('8000.00');
    });

    it('buckets by month', async () => {
      prisma.payment.findMany.mockResolvedValue([
        payment,
        { ...payment, paidOn: d('2026-04-05'), amount: money(10000) },
      ]);

      const report = await service.pnl({ fromDate: '2026-01-01', toDate: '2026-12-31', groupBy: 'month' });

      expect(report.buckets.map((b) => b.key)).toEqual(['2026-01', '2026-04']);
    });

    it('buckets by calendar quarter', async () => {
      prisma.payment.findMany.mockResolvedValue([payment, { ...payment, paidOn: d('2026-04-05') }]);

      const report = await service.pnl({ fromDate: '2026-01-01', toDate: '2026-12-31', groupBy: 'quarter' });

      expect(report.buckets.map((b) => b.key)).toEqual(['2026-Q1', '2026-Q2']);
    });

    it('breaks expenses down by category within a bucket', async () => {
      prisma.expense.findMany.mockResolvedValue([
        expense,
        { ...expense, amount: money(400), category: ExpenseCategory.UTILITY },
      ]);

      const report = await service.pnl({ fromDate: '2026-01-01', toDate: '2026-12-31', groupBy: 'year' });

      expect(report.buckets[0].expensesByCategory).toEqual([
        { category: ExpenseCategory.MAINTENANCE, amount: '1500.00' },
        { category: ExpenseCategory.UTILITY, amount: '400.00' },
      ]);
    });

    it('surfaces building-wide expenses separately when grouping by property', async () => {
      prisma.payment.findMany.mockResolvedValue([payment]);
      prisma.expense.findMany.mockResolvedValue([expense]);

      const report = await service.pnl({
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
        groupBy: 'property',
      });

      const keys = report.buckets.map((b) => b.key);
      expect(keys).toContain('property-uuid');
      expect(keys).toContain('building-wide:building-uuid');
    });

    it('excludes soft-deleted payments and expenses', async () => {
      await service.pnl({ fromDate: '2026-01-01', toDate: '2026-12-31' });

      expect(prisma.payment.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
      expect(prisma.expense.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    });

    it('400s when the range is inverted', async () => {
      await expect(service.pnl({ fromDate: '2026-12-31', toDate: '2026-01-01' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rent roll', () => {
    it('attaches the next unbanked cheque to its contract', async () => {
      prisma.cheque.findMany.mockResolvedValue([
        {
          id: 'cheque-uuid',
          contractId: 'contract-uuid',
          chequeNumber: '000123',
          bankName: 'FAB',
          amount: money(10000),
          chequeDate: d('2026-04-01'),
          status: ChequeStatus.HELD,
        },
      ]);

      const report = await service.rentRoll({ asOfDate: '2026-02-15' });

      expect(report.rows[0].nextCheque).toMatchObject({
        chequeNumber: '000123',
        amount: '10000.00',
        chequeDate: '2026-04-01',
      });
    });

    it('reports null when no cheque is on file', async () => {
      const report = await service.rentRoll({ asOfDate: '2026-02-15' });

      expect(report.rows[0].nextCheque).toBeNull();
    });

    it('only considers cheques not yet banked', async () => {
      await service.rentRoll({ asOfDate: '2026-02-15' });

      expect(prisma.cheque.findMany.mock.calls[0][0].where.status).toEqual({
        in: [ChequeStatus.HELD, ChequeStatus.DEPOSITED],
      });
    });
  });

  describe('upcoming cheques', () => {
    it('includes cheques already past their date, flagged overdue', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      prisma.cheque.findMany.mockResolvedValue([
        {
          id: 'cheque-uuid',
          chequeNumber: '000123',
          bankName: 'FAB',
          amount: money(10000),
          chequeDate: yesterday,
          status: ChequeStatus.HELD,
          contract,
        },
      ]);

      const report = await service.upcomingCheques({});

      expect(report.rows[0].isOverdue).toBe(true);
      expect(report.summary.overdue).toBe(1);
    });

    it('defaults to a 30-day look-ahead', async () => {
      const report = await service.upcomingCheques({});

      expect(report.withinDays).toBe(30);
    });

    it('totals the amount due in the window', async () => {
      prisma.cheque.findMany.mockResolvedValue([
        {
          id: 'a',
          chequeNumber: '1',
          bankName: 'FAB',
          amount: money(10000),
          chequeDate: d('2026-04-01'),
          status: ChequeStatus.HELD,
          contract,
        },
        {
          id: 'b',
          chequeNumber: '2',
          bankName: 'FAB',
          amount: money(5000),
          chequeDate: d('2026-04-05'),
          status: ChequeStatus.DEPOSITED,
          contract,
        },
      ]);

      const report = await service.upcomingCheques({});

      expect(report.summary.totalAmount).toBe('15000.00');
    });
  });

  describe('annual tenant count', () => {
    it('dedupes a tenant who signed twice in one year', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { startDate: d('2026-01-01'), tenantId: 'tenant-a' },
        { startDate: d('2026-06-01'), tenantId: 'tenant-a' },
        { startDate: d('2026-03-01'), tenantId: 'tenant-b' },
      ]);

      const rows = await service.annualTenantCount({ fromYear: 2026, toYear: 2026 });

      expect(rows).toEqual([{ year: 2026, tenantCount: 2, contractCount: 3 }]);
    });

    it('counts the same tenant again in a later year', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { startDate: d('2025-01-01'), tenantId: 'tenant-a' },
        { startDate: d('2026-01-01'), tenantId: 'tenant-a' },
      ]);

      const rows = await service.annualTenantCount({ fromYear: 2025, toYear: 2026 });

      expect(rows).toEqual([
        { year: 2025, tenantCount: 1, contractCount: 1 },
        { year: 2026, tenantCount: 1, contractCount: 1 },
      ]);
    });

    it('includes years with no lettings so a chart does not close the gap', async () => {
      prisma.contract.findMany.mockResolvedValue([{ startDate: d('2026-01-01'), tenantId: 'tenant-a' }]);

      const rows = await service.annualTenantCount({ fromYear: 2024, toYear: 2026 });

      expect(rows.map((r) => r.year)).toEqual([2024, 2025, 2026]);
      expect(rows[0].tenantCount).toBe(0);
    });

    it('filters by tenant type', async () => {
      await service.annualTenantCount({ fromYear: 2026, toYear: 2026, tenantType: 'COMPANY' as never });

      expect(prisma.contract.findMany.mock.calls[0][0].where.tenant).toEqual({ tenantType: 'COMPANY' });
    });

    it('400s when the year range is inverted', async () => {
      await expect(service.annualTenantCount({ fromYear: 2026, toYear: 2024 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

import { Module } from '@nestjs/common';
import { PaymentsController } from './payments/payments.controller';
import { ContractPaymentsController } from './payments/contract-payments.controller';
import { PaymentsService } from './payments/payments.service';
import { ChequesController } from './cheques/cheques.controller';
import { ContractChequesController } from './cheques/contract-cheques.controller';
import { ChequesService } from './cheques/cheques.service';
import { ExpensesController } from './expenses/expenses.controller';
import {
  BuildingExpensesController,
  PropertyExpensesController,
} from './expenses/scoped-expenses.controller';
import { ExpensesService } from './expenses/expenses.service';
import { PaymentAttachmentsController } from './payments/payment-attachments.controller';
import { PaymentAttachmentsService } from './payments/payment-attachments.service';
import { ChequeAttachmentsController } from './cheques/cheque-attachments.controller';
import { ChequeAttachmentsService } from './cheques/cheque-attachments.service';
import { ExpenseAttachmentsController } from './expenses/expense-attachments.controller';
import { ExpenseAttachmentsService } from './expenses/expense-attachments.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

/**
 * Finance owns money movement: payments, cheques, expenses, and the reports over
 * them. Dependencies point one way only — Finance reads Contracts / Buildings /
 * Properties, and none of them reference Finance (spec §2, §12).
 *
 * StorageService is not imported here — StorageModule is @Global.
 */
@Module({
  controllers: [
    PaymentsController,
    ContractPaymentsController,
    PaymentAttachmentsController,
    ChequesController,
    ContractChequesController,
    ChequeAttachmentsController,
    ExpensesController,
    BuildingExpensesController,
    PropertyExpensesController,
    ExpenseAttachmentsController,
    ReportsController,
  ],
  providers: [
    PaymentsService,
    ChequesService,
    ExpensesService,
    PaymentAttachmentsService,
    ChequeAttachmentsService,
    ExpenseAttachmentsService,
    ReportsService,
  ],
  // Exported so the Services module can create WORK_ORDER expenses through
  // ExpensesService when it is built, rather than writing to the table itself.
  exports: [PaymentsService, ChequesService, ExpensesService],
})
export class FinanceModule {}

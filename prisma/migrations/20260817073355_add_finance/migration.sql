-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('RENT', 'SECURITY_DEPOSIT', 'LATE_FEE', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('HELD', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'REPLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MAINTENANCE', 'UTILITY', 'INSURANCE', 'GOV_FEE', 'MUNICIPALITY_FEE', 'CLEANING', 'SECURITY', 'MANAGEMENT', 'LEGAL', 'SALARY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseSourceType" AS ENUM ('GENERAL', 'WORK_ORDER', 'UTILITY_BILL', 'IMPORT');

-- CreateEnum
CREATE TYPE "FinanceAttachmentType" AS ENUM ('RECEIPT', 'INVOICE', 'CHEQUE_IMAGE', 'BANK_STATEMENT', 'OTHER');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'RENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "cheque_id" UUID,
    "reference_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "cheque_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "cheque_date" DATE NOT NULL,
    "status" "ChequeStatus" NOT NULL DEFAULT 'HELD',
    "received_on" DATE NOT NULL,
    "deposited_on" DATE,
    "cleared_on" DATE,
    "bounced_on" DATE,
    "bounce_reason" TEXT,
    "replaced_by_cheque_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "property_id" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "incurred_on" DATE NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "invoice_number" TEXT,
    "source_type" "ExpenseSourceType" NOT NULL DEFAULT 'GENERAL',
    "source_ref_id" UUID,
    "source_ref_type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attachments" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" "FinanceAttachmentType" NOT NULL DEFAULT 'RECEIPT',
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_attachments" (
    "id" UUID NOT NULL,
    "cheque_id" UUID NOT NULL,
    "type" "FinanceAttachmentType" NOT NULL DEFAULT 'CHEQUE_IMAGE',
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cheque_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_attachments" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "type" "FinanceAttachmentType" NOT NULL DEFAULT 'INVOICE',
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_contract_id_idx" ON "payments"("contract_id");

-- CreateIndex
CREATE INDEX "payments_paid_on_idx" ON "payments"("paid_on");

-- CreateIndex
CREATE INDEX "payments_kind_idx" ON "payments"("kind");

-- CreateIndex
CREATE INDEX "payments_method_idx" ON "payments"("method");

-- CreateIndex
CREATE INDEX "payments_deleted_at_idx" ON "payments"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_cheque_id_key" ON "payments"("cheque_id");

-- CreateIndex
CREATE INDEX "cheques_bank_name_cheque_number_idx" ON "cheques"("bank_name", "cheque_number");

-- CreateIndex
CREATE INDEX "cheques_contract_id_idx" ON "cheques"("contract_id");

-- CreateIndex
CREATE INDEX "cheques_status_idx" ON "cheques"("status");

-- CreateIndex
CREATE INDEX "cheques_cheque_date_idx" ON "cheques"("cheque_date");

-- CreateIndex
CREATE INDEX "cheques_deleted_at_idx" ON "cheques"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_replaced_by_cheque_id_key" ON "cheques"("replaced_by_cheque_id");

-- CreateIndex
CREATE INDEX "expenses_building_id_idx" ON "expenses"("building_id");

-- CreateIndex
CREATE INDEX "expenses_property_id_idx" ON "expenses"("property_id");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_incurred_on_idx" ON "expenses"("incurred_on");

-- CreateIndex
CREATE INDEX "expenses_source_type_source_ref_id_idx" ON "expenses"("source_type", "source_ref_id");

-- CreateIndex
CREATE INDEX "expenses_deleted_at_idx" ON "expenses"("deleted_at");

-- CreateIndex
CREATE INDEX "payment_attachments_payment_id_idx" ON "payment_attachments"("payment_id");

-- CreateIndex
CREATE INDEX "payment_attachments_deleted_at_idx" ON "payment_attachments"("deleted_at");

-- CreateIndex
CREATE INDEX "cheque_attachments_cheque_id_idx" ON "cheque_attachments"("cheque_id");

-- CreateIndex
CREATE INDEX "cheque_attachments_deleted_at_idx" ON "cheque_attachments"("deleted_at");

-- CreateIndex
CREATE INDEX "expense_attachments_expense_id_idx" ON "expense_attachments"("expense_id");

-- CreateIndex
CREATE INDEX "expense_attachments_deleted_at_idx" ON "expense_attachments"("deleted_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_replaced_by_cheque_id_fkey" FOREIGN KEY ("replaced_by_cheque_id") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_attachments" ADD CONSTRAINT "cheque_attachments_cheque_id_fkey" FOREIGN KEY ("cheque_id") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_attachments" ADD CONSTRAINT "cheque_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: a cheque number is unique within a bank only among
-- non-deleted rows, so a soft-deleted cheque does not permanently reserve its
-- number. Not representable via Prisma @@unique, hence raw SQL — same approach
-- as buildings_code_active_key in 20260805085914_partial_unique_active_only.
CREATE UNIQUE INDEX "cheques_bank_name_cheque_number_active_key" ON "cheques"("bank_name", "cheque_number") WHERE "deleted_at" IS NULL;
